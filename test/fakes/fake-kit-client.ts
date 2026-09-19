import type {
  KitClient,
  KitResult,
  KitSubscriber,
  KitSubscriberInput,
} from "~/services/kit-client";

/** One call the fake received, in the order it received it. */
export type KitCall =
  | { method: "findSubscriberById"; id: number }
  | { method: "findSubscriberByEmail"; email: string }
  | { method: "createSubscriber"; input: KitSubscriberInput }
  | { method: "updateSubscriber"; id: number; input: KitSubscriberInput }
  | { method: "addSubscriberToTag"; tagId: number; subscriberId: number };

/** Responses queued per method, consumed in order, ahead of the default. */
interface ScriptedResponses {
  findSubscriberById: KitResult<KitSubscriber | null>[];
  findSubscriberByEmail: KitResult<KitSubscriber | null>[];
  createSubscriber: KitResult<KitSubscriber>[];
  updateSubscriber: KitResult<KitSubscriber>[];
  addSubscriberToTag: KitResult<void>[];
}

/**
 * An in-memory `KitClient` that records every call and answers from a script.
 *
 * The findings the Kit design rests on were observed live and are not
 * reproducible from a happy-path stub, so the fake has to be able to lie in
 * exactly the ways Kit does:
 *
 * - `script.createSubscriber` can return `201` with a non-empty `warnings`
 *   array, which is a permanent failure however healthy the status looks.
 * - `subscribers` can hold a cancelled subscriber, and `findSubscriberByEmail`
 *   returns it — the worker is what must ask with `status=all`, and a test of
 *   the "reads as absent" bug scripts the null explicitly.
 * - `script.updateSubscriber` can return a `404`, which is a reschedule.
 * - `onBeforeWrite` flips a subscriber's `state` between a read and a write,
 *   which is the race the write's own response has to re-check.
 */
export class FakeKitClient implements KitClient {
  readonly calls: KitCall[] = [];

  /** Subscribers the fake knows about, by id. */
  readonly subscribers = new Map<number, KitSubscriber>();

  private readonly script: ScriptedResponses = {
    findSubscriberById: [],
    findSubscriberByEmail: [],
    createSubscriber: [],
    updateSubscriber: [],
    addSubscriberToTag: [],
  };

  /** Runs immediately before a write lands, to stage a read/write race. */
  onBeforeWrite?: (fake: FakeKitClient) => void;

  private nextId = 1;

  /** Queue a response for the next call to a method. */
  scriptNext<M extends keyof ScriptedResponses>(
    method: M,
    response: ScriptedResponses[M][number],
  ): this {
    // The narrowing is real but not expressible: indexing a union of array
    // types gives `push` an intersection parameter.
    (this.script[method] as ScriptedResponses[M][number][]).push(response);
    return this;
  }

  /** Put a subscriber into the fake's world without going through a call. */
  givenSubscriber(
    subscriber: Omit<KitSubscriber, "id"> & { id?: number },
  ): KitSubscriber {
    const stored: KitSubscriber = { id: subscriber.id ?? this.nextId++, ...subscriber };
    this.subscribers.set(stored.id, stored);
    return stored;
  }

  async findSubscriberById(
    id: number,
  ): Promise<KitResult<KitSubscriber | null>> {
    this.calls.push({ method: "findSubscriberById", id });
    return (
      this.script.findSubscriberById.shift() ??
      ok(this.subscribers.get(id) ?? null)
    );
  }

  async findSubscriberByEmail(
    email: string,
  ): Promise<KitResult<KitSubscriber | null>> {
    this.calls.push({ method: "findSubscriberByEmail", email });
    if (this.script.findSubscriberByEmail.length > 0) {
      return this.script.findSubscriberByEmail.shift()!;
    }
    const found = [...this.subscribers.values()].find(
      (subscriber) => subscriber.email_address === email,
    );
    return ok(found ?? null);
  }

  async createSubscriber(
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>> {
    this.calls.push({ method: "createSubscriber", input });
    this.onBeforeWrite?.(this);
    if (this.script.createSubscriber.length > 0) {
      return this.script.createSubscriber.shift()!;
    }
    const created = this.givenSubscriber({
      email_address: input.email_address,
      state: "active",
      fields: { ...input.fields },
    });
    return { ok: true, status: 201, data: created, warnings: [] };
  }

  async updateSubscriber(
    id: number,
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>> {
    this.calls.push({ method: "updateSubscriber", id, input });
    this.onBeforeWrite?.(this);
    if (this.script.updateSubscriber.length > 0) {
      return this.script.updateSubscriber.shift()!;
    }
    const existing = this.subscribers.get(id);
    if (!existing) return { ok: false, status: 404, warnings: [] };

    // Kit does not defend a cancelled subscriber against writes; it accepts
    // them and answers 200. The guard is ours, on the response's own `state`.
    const updated: KitSubscriber = {
      ...existing,
      email_address: input.email_address,
      fields: { ...existing.fields, ...input.fields },
    };
    this.subscribers.set(id, updated);
    return ok(updated);
  }

  async addSubscriberToTag(
    tagId: number,
    subscriberId: number,
  ): Promise<KitResult<void>> {
    this.calls.push({ method: "addSubscriberToTag", tagId, subscriberId });
    this.onBeforeWrite?.(this);
    return this.script.addSubscriberToTag.shift() ?? ok(undefined);
  }

  /** Every call to one method, for asserting on what the worker actually asked. */
  callsTo<M extends KitCall["method"]>(
    method: M,
  ): Extract<KitCall, { method: M }>[] {
    return this.calls.filter(
      (call): call is Extract<KitCall, { method: M }> => call.method === method,
    );
  }
}

function ok<T>(data: T): KitResult<T> {
  return { ok: true, status: 200, data, warnings: [] };
}
