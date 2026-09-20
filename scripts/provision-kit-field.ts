/**
 * Provision the `practice_state` custom field in Kit. Idempotent, and run by
 * hand.
 *
 *   npm run kit:provision
 *
 * The field **must pre-exist** before any Kit Sync Job writes to it. Kit does
 * not refuse a write to a key it does not know: it answers `201`, drops the
 * key, and puts a line in a `warnings` array — which is exactly the shape the
 * worker treats as a permanent failure, so an unprovisioned field turns every
 * job into a dead letter rather than a silent gap.
 *
 * Kit derives the key from the label, so **the label is never renamed**:
 * `Practice State` is what makes the key `practice_state`, and renaming it in
 * Kit's dashboard would rename the key and break every write afterwards. That
 * is the reason this is a script rather than something the worker does on the
 * fly — provisioning is a decision about the Kit account, taken once, not a
 * thing to retry per job.
 *
 * Idempotent by reading first: it lists the account's custom fields and
 * creates ours only if nothing already carries the key. Running it twice is
 * two GETs and no writes.
 */
import {
  KIT_PRACTICE_STATE_FIELD_KEY,
  KIT_PRACTICE_STATE_FIELD_LABEL,
} from "../app/services/kit-client";
import { KIT_API_BASE, kitApiKey } from "../app/services/kit-http-client";

const apiKey = kitApiKey();
if (!apiKey) {
  console.error("KIT_API_KEY is not set, so there is no account to provision.");
  process.exit(1);
}

async function kit(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${KIT_API_BASE}${path}`, {
    method,
    headers: {
      "X-Kit-Api-Key": apiKey!,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

const existing = await kit("GET", "/v4/custom_fields");
if (existing.status !== 200) {
  console.error(`Kit refused the field list (${existing.status}).`);
  process.exit(1);
}

const already = (existing.payload.custom_fields ?? []).find(
  (field: { key?: string }) => field.key === KIT_PRACTICE_STATE_FIELD_KEY,
);

if (already) {
  console.log(
    `Kit already has ${KIT_PRACTICE_STATE_FIELD_KEY} ` +
      `(id ${already.id}, label "${already.label}"). Nothing to do.`,
  );
  process.exit(0);
}

const created = await kit("POST", "/v4/custom_fields", {
  label: KIT_PRACTICE_STATE_FIELD_LABEL,
});

if (created.status >= 300) {
  console.error(`Kit refused the field (${created.status}).`);
  process.exit(1);
}

const field = created.payload.custom_field ?? {};

// The key is Kit's to derive, so it is read back rather than assumed. A key
// that is not ours means the label collided with an existing field and Kit
// disambiguated it — which every write after this would then warn about.
if (field.key !== KIT_PRACTICE_STATE_FIELD_KEY) {
  console.error(
    `Kit made the key "${field.key}", not "${KIT_PRACTICE_STATE_FIELD_KEY}". ` +
      "Fix it in Kit before draining any job: every write would warn and dead-letter.",
  );
  process.exit(1);
}

console.log(`Created ${field.key} (id ${field.id}, label "${field.label}").`);
