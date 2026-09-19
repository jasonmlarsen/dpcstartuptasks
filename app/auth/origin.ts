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
 * React Router v8 refuses a mismatched `Origin` before any action runs, so
 * this covers what that one does not: a `POST` carrying no `Origin` at all,
 * and one whose origin matches the URL the app was reached at but not the URL
 * the app is actually served from. `Origin` is set by every browser on a form
 * submission and cannot be forged by page script, so its absence is as
 * disqualifying as a wrong value and there is no fallback header to consult.
 */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(appUrl()).origin;
}
