import type {
  KitClient,
  KitResult,
  KitSubscriber,
  KitSubscriberInput,
} from "./kit-client";

/**
 * The real `KitClient`: Kit's v4 API over plain `fetch`, and no SDK.
 *
 * Five calls, one header and no dependency. An SDK here would buy retries and
 * error classes that are both wrong for this product — the queue already owns
 * retrying, and the two things that decide a job's fate are a `warnings` array
 * on a `2xx` and the `state` on a write's own response, neither of which a
 * client library would hand back without being fought.
 *
 * Nothing above this file knows Kit answers over HTTP. The worker holds a
 * `KitClient` and a test holds `FakeKitClient`, which is what lets the fake lie
 * the way Kit lies.
 */

/** Kit's v4 root. Exported for the provisioning script, which is the one
 *  other thing in this repo that talks to Kit. */
export const KIT_API_BASE = "https://api.kit.com";

/**
 * Where the Kit API key lives, settled here rather than deferred again: the
 * `KIT_API_KEY` environment variable, set on the host beside `AUTH_SECRET`,
 * and never in this repo (ADR-0008).
 *
 * Deliberately **not** asserted at boot the way `app/auth/config.ts` asserts
 * its three. Sign-in is the only way into the product, so a missing
 * `AUTH_SECRET` is a container that must not start; Kit is a newsletter, so a
 * missing key must not take the product down with it. What it stops is the
 * worker, and the queue holds the jobs until somebody sets it.
 */
export function kitApiKey(): string | undefined {
  return process.env.KIT_API_KEY || undefined;
}

/** Build the production client. Throws if there is no key to call Kit with. */
export function createKitClient(
  apiKey: string | undefined = kitApiKey(),
): KitClient {
  if (!apiKey) {
    throw new Error(
      "KIT_API_KEY is not set, so no Kit Sync Job can be drained. " +
        "Registration and the product are unaffected; the queue holds.",
    );
  }

  return new HttpKitClient(apiKey);
}

/**
 * The path a read-by-address goes to, percent-encoded and with `status=all`.
 *
 * Exported because it is the one piece of this file with a rule on it rather
 * than a shape. **Without `status=all` a cancelled subscriber reads as
 * absent**, and a worker that believes it POSTs straight through the wall
 * meant to stop it, creating the subscriber Kit just told us had left. The
 * `+` in `dr.reed+dpc@example.com` is the other half: unencoded it reaches Kit
 * as a space and matches nobody, which reads as absent in exactly the same
 * way.
 */
export function subscriberSearchPath(email: string): string {
  return `/v4/subscribers?email_address=${encodeURIComponent(email)}&status=all`;
}

class HttpKitClient implements KitClient {
  constructor(private readonly apiKey: string) {}

  async findSubscriberById(
    id: number,
  ): Promise<KitResult<KitSubscriber | null>> {
    const response = await this.call("GET", `/v4/subscribers/${id}`);

    // A read that finds nobody is an answer, not a failure: the id we hold was
    // deleted in Kit's dashboard, and the job that asked defers rather than
    // dying.
    if (response.status === 404) {
      return { ok: true, status: 404, data: null, warnings: response.warnings };
    }
    if (!response.ok) return response;

    return { ...response, data: subscriberFrom(response.body) };
  }

  async findSubscriberByEmail(
    email: string,
  ): Promise<KitResult<KitSubscriber | null>> {
    const response = await this.call("GET", subscriberSearchPath(email));
    if (!response.ok) return response;

    // Kit answers a search with a list, and an empty one is a subscriber who
    // is not there — which, with `status=all` on the URL above, is the truth
    // rather than the half of it that omitting the parameter returns.
    const subscribers = (response.body as { subscribers?: unknown[] }).subscribers;
    const first = Array.isArray(subscribers) ? subscribers[0] : undefined;

    return {
      ...response,
      data: first ? subscriberFrom({ subscriber: first }) : null,
    };
  }

  async createSubscriber(
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>> {
    return this.write("POST", "/v4/subscribers", input);
  }

  async updateSubscriber(
    id: number,
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>> {
    return this.write("PUT", `/v4/subscribers/${id}`, input);
  }

  async addSubscriberToTag(
    tagId: number,
    subscriberId: number,
  ): Promise<KitResult<void>> {
    // #41 spells this `POST /v4/tags/{tagId}/subscribers`, which is Kit's
    // by-address form and takes an `email_address` in the body. We hold an id
    // by this point — a read or a write has just handed one back — so this
    // uses that endpoint's id-bearing sibling instead: exact, and with no
    // second chance to tag the wrong person. Worth re-checking against Kit's
    // docs if tagging ever starts 404ing.
    const response = await this.call(
      "POST",
      `/v4/tags/${tagId}/subscribers/${subscriberId}`,
    );
    if (!response.ok) return response;

    return { ok: true, status: response.status, data: undefined, warnings: response.warnings };
  }

  private async write(
    method: "POST" | "PUT",
    path: string,
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>> {
    const response = await this.call(method, path, input);
    if (!response.ok) return response;

    return { ...response, data: subscriberFrom(response.body) };
  }

  /**
   * One call, and the only place a status code becomes an `ok`.
   *
   * `warnings` rides out alongside `ok` rather than collapsing into it,
   * because the caller is the one that has to decide: Kit answered a bogus
   * field key with `201`, a warning, and a subscriber whose field was
   * silently dropped, so a client that read only the status code would be
   * reporting a success that did not happen.
   */
  private async call(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<
    | { ok: true; status: number; warnings: string[]; body: unknown }
    | { ok: false; status: number; warnings: string[] }
  > {
    let response: Response;
    try {
      response = await fetch(`${KIT_API_BASE}${path}`, {
        method,
        headers: {
          // Kit v4's own header, not a bearer token.
          "X-Kit-Api-Key": this.apiKey,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // A refused connection and a 500 are the same fact to the queue: Kit did
      // not answer, so the job runs again. Status 0 is *never reached Kit*.
      return { ok: false, status: 0, warnings: [] };
    }

    const parsed = await readJson(response);
    const warnings = warningsFrom(parsed);

    if (!response.ok) return { ok: false, status: response.status, warnings };

    return { ok: true, status: response.status, warnings, body: parsed };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A 204 and an HTML error page both land here. Neither carries a warning
    // and neither is a subscriber, which the callers above already handle.
    return {};
  }
}

/**
 * Kit's warnings, however it spells them.
 *
 * Read defensively on purpose: this array is the difference between a write
 * that landed and one that was accepted and dropped, so a shape we do not
 * recognise must not read as *no warnings*. Anything non-empty and non-string
 * is carried through as its JSON so an operator sees what Kit actually said.
 */
function warningsFrom(body: unknown): string[] {
  const raw = (body as { warnings?: unknown })?.warnings;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw.map((warning) =>
    typeof warning === "string" ? warning : JSON.stringify(warning),
  );
}

/** Kit wraps a single subscriber in `{ subscriber: ... }` on every endpoint. */
function subscriberFrom(body: unknown): KitSubscriber {
  const subscriber = (body as { subscriber?: KitSubscriber }).subscriber;

  return {
    id: Number(subscriber?.id),
    email_address: String(subscriber?.email_address ?? ""),
    state: subscriber?.state ?? "inactive",
    fields: subscriber?.fields ?? {},
  };
}
