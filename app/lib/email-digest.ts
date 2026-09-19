import { createHash } from "node:crypto";

/**
 * An email address reduced to a digest, for the two tables that are keyed by
 * an address nobody has proved they own.
 *
 * Anyone at all can put an address into `sign_in_link_request` or
 * `pending_email_consent` by typing it into the sign-in form, so neither may
 * become a record of who was asked about. Both must key it the same way or a
 * physician who typed their address with a capital on Tuesday would be a
 * different person on Wednesday — which is why this lives in one place rather
 * than once per caller.
 */
export function emailDigest(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
