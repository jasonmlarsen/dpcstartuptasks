/**
 * Seam 2, half two: Kit as an injected client.
 *
 * Kit is the newsletter, never the product: the app makes no Kit call from any
 * loader, only from the worker draining the sync queue. The interface is
 * deliberately shaped around the two findings the design rests on — that a
 * read without `status=all` cannot see a cancelled subscriber, and that a 2xx
 * carrying a non-empty `warnings` array is a permanent failure, not a success.
 * Both are visible to a caller here, so both can be tested against the fake.
 */
export interface KitClient {
  /**
   * Read by id. The preferred path, and the only one that exists once a
   * `subscriber.id` has been persisted at registration.
   */
  findSubscriberById(id: number): Promise<KitResult<KitSubscriber | null>>;

  /**
   * Read by address. Always percent-encoded and always `status=all`, because
   * without that parameter a cancelled subscriber reads as absent and the
   * worker writes through the wall meant to stop it.
   */
  findSubscriberByEmail(
    email: string,
  ): Promise<KitResult<KitSubscriber | null>>;

  createSubscriber(input: KitSubscriberInput): Promise<KitResult<KitSubscriber>>;

  /** `PUT /v4/subscribers/{id}`. A 404 here is a reschedule, not a dead letter. */
  updateSubscriber(
    id: number,
    input: KitSubscriberInput,
  ): Promise<KitResult<KitSubscriber>>;

  addSubscriberToTag(
    tagId: number,
    subscriberId: number,
  ): Promise<KitResult<void>>;
}

/** Kit's own lifecycle value. Only `state` is proof of consent; a tag is not. */
export type KitSubscriberState = "active" | "inactive" | "cancelled" | "bounced";

export interface KitSubscriber {
  id: number;
  email_address: string;
  state: KitSubscriberState;
  fields: Record<string, string | null>;
}

export interface KitSubscriberInput {
  email_address: string;
  /** Kit derives field keys from labels; ours is `practice_state`, never `state`. */
  fields?: Record<string, string>;
}

/**
 * Every call's outcome, warnings included.
 *
 * `warnings` is separate from `ok` on purpose. Kit answered a bogus field key
 * with `201` and a warning, created the subscriber, and silently dropped the
 * key — so a caller that reads only the status code is reading a lie. Callers
 * must treat a non-empty `warnings` on a successful response as a permanent
 * failure.
 */
export type KitResult<T> =
  | { ok: true; status: number; data: T; warnings: string[] }
  | { ok: false; status: number; warnings: string[] };

/**
 * The one tag every consenting address is put on: `launch-tasks-signup`.
 *
 * An id rather than a name, because Kit's tag endpoints take ids and a name
 * lookup would be a second call that can fail on its own. Registration is
 * never routed through a Kit form — a form would mean a second consent
 * screen, in somebody else's product, between a physician and their list.
 */
export const KIT_SIGNUP_TAG_ID = 23720088;

/**
 * The custom field the Practice State is written to.
 *
 * **Keyed `practice_state`, never `state`.** Kit derives a field's key from
 * its label, so renaming the label renames the key and every write after that
 * silently becomes a warning instead of a value — which is why the label is
 * never renamed and why provisioning is a scripted, idempotent act
 * (`scripts/provision-kit-field.ts`) rather than something the worker does
 * on the fly. The field must pre-exist; a job that writes to a missing key
 * gets a `201` and a warning, and that is a permanent failure.
 *
 * Kit's own id for it is `1369854`. Nothing here sends it — every write
 * addresses the field by key, which is the name Kit resolves — so it is
 * recorded in this sentence rather than as a constant nobody reads.
 */
export const KIT_PRACTICE_STATE_FIELD_KEY = "practice_state";
export const KIT_PRACTICE_STATE_FIELD_LABEL = "Practice State";

/**
 * The Kit-hosted Resubscribe Form: the only way a Cancelled subscriber
 * becomes active again, and the only part of the consent flow Launch Tasks
 * does not own.
 *
 * `state` is create-only on Kit's API, so there is no write that resurrects
 * anyone — the app links to this and never operates it. Its double opt-in
 * stays on deliberately: the confirmation email *is* the explicit permission
 * Kit requires.
 */
export const KIT_RESUBSCRIBE_FORM_URL = "https://directcaretools.kit.com/resubscribe";
