import { appUrl } from "./config";

/**
 * Our own origin check on the Continue Screen's `POST`.
 *
 * Better Auth's router-level origin check is one of the two things lost by
 * never mounting `auth.handler` (ADR-0004), and the Continue leg is exactly
 * where it mattered: the `POST` mints a session, so a form on someone else's
 * page submitting a token they hold must not be able to plant one in a
 * physician's browser.
 *
 * `Origin` is set by every browser on a cross-origin form submission and
 * cannot be forged by page script, so its absence is as disqualifying as a
 * wrong value. `Referer` is the fallback for the handful of clients that strip
 * `Origin`; if both are missing the request is refused rather than trusted.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(appUrl()).origin;

  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  return false;
}
