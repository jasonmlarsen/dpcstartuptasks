import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "~/database/database";
import {
  kitSyncJob,
  membership,
  practice,
  user,
  type KitSyncKind,
  type KitSyncOutcome,
} from "~/database/schema";
import {
  KIT_PRACTICE_STATE_FIELD_KEY,
  KIT_SIGNUP_TAG_ID,
  type KitClient,
  type KitResult,
  type KitSubscriber,
  type KitSubscriberInput,
} from "~/services/kit-client";

/**
 * `drainQueue`: the worker that is the only thing in this product that calls
 * Kit.
 *
 * Seam 3, the worker seam, and the same shape as the Feedback Digest —
 * dependencies as arguments, `now` among them, and no request anywhere near
 * it. It is genuinely request-less: nobody is waiting on it, which is the
 * point. Registration hands Kit a row in a table and walks away.
 *
 * Four rules run the whole file, and each one exists because Kit did
 * something that a reasonable reading of its status codes would have missed:
 *
 * 1. **Read before write, always**, by `subscriber.id` where one exists and
 *    otherwise by percent-encoded address with `status=all`. Without that
 *    parameter a cancelled subscriber reads as absent, and the write that
 *    follows goes straight through the wall meant to stop it.
 * 2. **Cancelled is a hard wall.** No subscriber, no tag, no field. The job
 *    succeeds with outcome `suppressed` — never a failure, never retried,
 *    never dead-lettered — and `kit_suppressed_at` is written locally so that
 *    settings can explain the refusal without calling Kit.
 * 3. **The write's own response is re-read.** A subscriber can cancel between
 *    the read and the write; Kit does not defend against that and answers
 *    `200`, so the guard is ours and it is on the response.
 * 4. **A non-empty `warnings` array on a `2xx` is a permanent failure.** Kit
 *    answered a bogus field key with `201`, a warning, and a subscriber whose
 *    field had been silently dropped. A `2xx` alone never means success on a
 *    request carrying `fields`.
 *
 * Rule 2 is where *never consented* and *Cancelled* collapse into one worker
 * rule: in both cases there is no permission in hand, so nothing is written
 * and the job succeeds having done nothing.
 */

/** How many jobs one drain takes. A scheduler calls this often; batches stay small. */
const DRAIN_BATCH = 50;

/**
 * How many times a job may be picked up before it is dead-lettered.
 *
 * With the backoff below this is a bit over a day of trying, which is longer
 * than any Kit outage this product needs to survive and short enough that a
 * job nobody can succeed at stops occupying the queue.
 */
const MAX_ATTEMPTS = 10;

/** A minute, doubling, capped at six hours. */
const FIRST_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

/** What one drain did. Every number is jobs, not Kit calls. */
export interface DrainedQueue {
  picked: number;
  synced: number;
  suppressed: number;
  failed: number;
  /** Ran, could not finish, and went back in the queue. Not a failure. */
  deferred: number;
}

/**
 * Drain the queue: every job whose turn has come, oldest first.
 *
 * Serial rather than parallel on purpose. The whole queue is a handful of
 * rows a day at this scale, two jobs for one address would race each other
 * through the read-then-write above, and Kit's rate limit is a thing worth
 * never meeting.
 */
export async function drainQueue(
  database: AppDatabase,
  kitClient: KitClient,
  now: Date = new Date(),
): Promise<DrainedQueue> {
  const due = database
    .select()
    .from(kitSyncJob)
    .where(and(isNull(kitSyncJob.outcome), lte(kitSyncJob.runAfter, now)))
    .orderBy(asc(kitSyncJob.id))
    .limit(DRAIN_BATCH)
    .all();

  const drained: DrainedQueue = {
    picked: due.length,
    synced: 0,
    suppressed: 0,
    failed: 0,
    deferred: 0,
  };

  for (const job of due) {
    const attempts = job.attempts + 1;
    const decided = await runJob(database, kitClient, job.userId, job.kind, now);

    if (decided.settle) {
      settle(database, job.id, attempts, decided.settle, decided.detail, now);
      drained[decided.settle] += 1;
      continue;
    }

    // Out of attempts is the one way a deferral becomes a dead letter: the
    // job is not wrong, it has simply never been able to run, and a queue
    // that holds those forever hides the outage that caused them.
    if (attempts >= MAX_ATTEMPTS) {
      settle(
        database,
        job.id,
        attempts,
        "failed",
        `gave up after ${attempts} attempts: ${decided.detail}`,
        now,
      );
      drained.failed += 1;
      continue;
    }

    defer(database, job.id, attempts, decided.detail, now);
    drained.deferred += 1;
  }

  return drained;
}

/** Settled, or put back. A deferral carries its reason for the operator too. */
type Decision =
  | { settle: KitSyncOutcome; detail: string | null }
  | { settle: null; detail: string };

/** Everything a job needs to know about the User it is about. */
interface Subject {
  userId: string;
  email: string;
  consented: boolean;
  subscriberId: number | null;
  suppressed: boolean;
  practiceState: string | null;
}

async function runJob(
  database: AppDatabase,
  kitClient: KitClient,
  userId: string,
  kind: KitSyncKind,
  now: Date,
): Promise<Decision> {
  const subject = subjectFor(database, userId);

  // Unreachable in practice — a deleted User takes their jobs with them — and
  // settled rather than retried if it ever happens, because no number of
  // attempts will bring the row back.
  if (!subject) {
    return { settle: "suppressed", detail: "the user is gone" };
  }

  // Rule 2, the half of it that never reaches Kit at all. A job for somebody
  // who never consented is not an error to report; it is a job with nothing
  // to write, which is what `suppressed` means.
  if (!subject.consented) {
    return { settle: "suppressed", detail: "no email consent is recorded" };
  }

  return kind === "signup"
    ? signUp(database, kitClient, subject, now)
    : writePracticeState(database, kitClient, subject, now);
}

/**
 * The signup job: the subscriber, the tag and the Practice State field.
 *
 * The only job that may create a subscriber, and it only does so having
 * looked and found nobody — with `status=all` on the search, so that *nobody*
 * means nobody rather than nobody active.
 */
async function signUp(
  database: AppDatabase,
  kitClient: KitClient,
  subject: Subject,
  now: Date,
): Promise<Decision> {
  const read = await readBeforeWriting(kitClient, subject);

  if (!read.ok) return { settle: null, detail: `read failed (${read.status})` };

  const existing = read.data;
  if (existing && existing.state === "cancelled") {
    return suppress(database, subject, now, "kit reports this address cancelled");
  }

  const input = subscriberInput(subject);
  const written = existing
    ? await kitClient.updateSubscriber(existing.id, input)
    : await kitClient.createSubscriber(input);

  const landed = afterWrite(database, subject, written, now);
  if ("decided" in landed) return landed.decided;

  // The tag last, and only once the subscriber is real and not cancelled. A
  // tag is not consent — `state` is — so it is never the thing that lets a
  // write past the wall, only the thing that says which list this is.
  const tagged = await kitClient.addSubscriberToTag(
    KIT_SIGNUP_TAG_ID,
    landed.subscriber.id,
  );

  if (!tagged.ok) {
    return { settle: null, detail: `tagging failed (${tagged.status})` };
  }
  if (tagged.warnings.length > 0) {
    return { settle: "failed", detail: warningDetail(tagged.warnings) };
  }

  return { settle: "synced", detail: null };
}

/**
 * The read that has to happen before any write: by `subscriber.id` where one
 * exists, and **otherwise, or when that id names nobody**, by percent-encoded
 * address with `status=all`.
 *
 * The fallback is the part that is easy to leave out and expensive to. An id
 * can go stale — a subscriber deleted in Kit's dashboard, or an account
 * rebuilt — and a read by a stale id answers *nobody*, which is the same
 * answer the address read gives for somebody who genuinely never signed up.
 * Believing the first one means creating a subscriber for an address that may
 * be sitting there Cancelled under a different id, which is the wall this
 * whole file is built to hold.
 */
async function readBeforeWriting(
  kitClient: KitClient,
  subject: Subject,
): Promise<KitResult<KitSubscriber | null>> {
  if (subject.subscriberId) {
    const byId = await kitClient.findSubscriberById(subject.subscriberId);
    if (!byId.ok || byId.data) return byId;
  }

  return kitClient.findSubscriberByEmail(subject.email);
}

/**
 * The Practice State job: one field on a subscriber that already exists.
 *
 * It never creates anybody. No stored `subscriber.id` means the first sync has
 * not landed yet, and this job defers rather than racing it — two jobs both
 * deciding to create would be the one way this queue could produce a duplicate
 * subscriber.
 */
async function writePracticeState(
  database: AppDatabase,
  kitClient: KitClient,
  subject: Subject,
  now: Date,
): Promise<Decision> {
  if (!subject.subscriberId) {
    return { settle: null, detail: "the first sync has not landed yet" };
  }

  const read = await kitClient.findSubscriberById(subject.subscriberId);
  if (!read.ok) return { settle: null, detail: `read failed (${read.status})` };

  // A read that finds nobody is the same deferral: the id we hold is stale,
  // and the signup job is the only thing allowed to mint a new one.
  if (!read.data) {
    return { settle: null, detail: "no subscriber under the stored id" };
  }
  if (read.data.state === "cancelled") {
    return suppress(database, subject, now, "kit reports this address cancelled");
  }

  const written = await kitClient.updateSubscriber(
    subject.subscriberId,
    subscriberInput(subject),
  );

  const landed = afterWrite(database, subject, written, now);
  if ("decided" in landed) return landed.decided;

  return { settle: "synced", detail: null };
}

/**
 * What a write's own response means, which is not what its status code says.
 *
 * Three readings in one place, so that neither job can make four of them:
 * a `404` on a `PUT` is a reschedule rather than a dead letter, a non-empty
 * `warnings` array on a `2xx` is a permanent failure, and a `state` of
 * `cancelled` on the response is the read/write race — the subscriber left
 * between our read and our write, Kit took the write anyway, and the wall is
 * ours to put back up.
 *
 * Answers either the decision that ends the job, or the subscriber Kit just
 * handed back for the caller to carry on with.
 */
function afterWrite(
  database: AppDatabase,
  subject: Subject,
  written: KitResult<KitSubscriber>,
  now: Date,
): { decided: Decision } | { subscriber: KitSubscriber } {
  if (!written.ok) {
    // Kit no longer holds the id we wrote to. Nothing is wrong with the job,
    // so it goes back in the queue and the next run reads again — by address
    // if the id is cleared, which is what makes this recoverable rather than
    // a row that can only ever 404.
    if (written.status === 404) {
      forgetSubscriberId(database, subject);
      return {
        decided: { settle: null, detail: "the stored subscriber id is gone (404)" },
      };
    }
    return {
      decided: { settle: null, detail: `write failed (${written.status})` },
    };
  }

  if (written.warnings.length > 0) {
    return {
      decided: { settle: "failed", detail: warningDetail(written.warnings) },
    };
  }

  if (written.data.state === "cancelled") {
    return {
      decided: suppress(
        database,
        subject,
        now,
        "cancelled between the read and the write",
      ),
    };
  }

  rememberSubscriber(database, subject, written.data.id);
  return { subscriber: written.data };
}

/** The fields a write carries: the Practice State, keyed `practice_state`. */
function subscriberInput(subject: Subject): KitSubscriberInput {
  return {
    email_address: subject.email,
    // A Practice that has not said which state it is in has nothing to write.
    // Sending an empty string would set the field to one rather than leave it.
    ...(subject.practiceState
      ? { fields: { [KIT_PRACTICE_STATE_FIELD_KEY]: subject.practiceState } }
      : {}),
  };
}

/**
 * The hard wall: write nothing to Kit, record the observation locally, and
 * call the job a success.
 *
 * Never a failure and never retried. Kit treats Cancelled as permanent and
 * consent-revoking and so does this product — the physician asked, nothing
 * punitive happened, and only they can leave the state, through the
 * Resubscribe Form the settings page links to.
 */
function suppress(
  database: AppDatabase,
  subject: Subject,
  now: Date,
  detail: string,
): Decision {
  database
    .update(user)
    .set({ kitSuppressedAt: now })
    .where(eq(user.id, subject.userId))
    .run();

  return { settle: "suppressed", detail };
}

/**
 * Persist the `subscriber.id`, and clear a Suppressed that Kit has just
 * contradicted.
 *
 * Suppressed is a cached observation rather than a verdict, and this is where
 * the cache is corrected: a physician who went through the Resubscribe Form
 * comes back `active` carrying the same id, and the next job to read them
 * clears the column so settings stops explaining a refusal that has stopped
 * happening.
 */
function rememberSubscriber(
  database: AppDatabase,
  subject: Subject,
  subscriberId: number,
): void {
  if (subject.subscriberId === subscriberId && !subject.suppressed) return;

  database
    .update(user)
    .set({ kitSubscriberId: subscriberId, kitSuppressedAt: null })
    .where(eq(user.id, subject.userId))
    .run();
}

function forgetSubscriberId(database: AppDatabase, subject: Subject): void {
  database
    .update(user)
    .set({ kitSubscriberId: null })
    .where(eq(user.id, subject.userId))
    .run();
}

/** Everything one job needs about its User, read live at drain time. */
function subjectFor(database: AppDatabase, userId: string): Subject | null {
  const row = database
    .select({
      email: user.email,
      consentGrantedAt: user.emailConsentGrantedAt,
      subscriberId: user.kitSubscriberId,
      suppressedAt: user.kitSuppressedAt,
      practiceState: practice.state,
    })
    .from(user)
    // A User with no Practice — one whose Practice is in its Grace Period
    // still has a Membership — simply has no state to tell Kit about.
    .leftJoin(membership, eq(membership.userId, user.id))
    .leftJoin(practice, eq(practice.id, membership.practiceId))
    .where(eq(user.id, userId))
    .get();

  if (!row) return null;

  return {
    userId,
    email: row.email,
    consented: row.consentGrantedAt !== null,
    subscriberId: row.subscriberId,
    suppressed: row.suppressedAt !== null,
    practiceState: row.practiceState,
  };
}

function settle(
  database: AppDatabase,
  jobId: number,
  attempts: number,
  outcome: KitSyncOutcome,
  detail: string | null,
  now: Date,
): void {
  database
    .update(kitSyncJob)
    .set({ attempts, outcome, detail, settledAt: now })
    .where(eq(kitSyncJob.id, jobId))
    .run();
}

function defer(
  database: AppDatabase,
  jobId: number,
  attempts: number,
  detail: string,
  now: Date,
): void {
  const wait = Math.min(FIRST_RETRY_MS * 2 ** (attempts - 1), MAX_RETRY_MS);

  database
    .update(kitSyncJob)
    .set({ attempts, detail, runAfter: new Date(now.getTime() + wait) })
    .where(eq(kitSyncJob.id, jobId))
    .run();
}

/** What Kit warned about, kept whole: it names the key that was dropped. */
function warningDetail(warnings: string[]): string {
  return `kit answered with warnings: ${warnings.join("; ")}`;
}
