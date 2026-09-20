import { data } from "react-router";

import { getSignedInAdmin, type SignedInUser } from "~/auth/server";
import type { AppServices } from "~/services/services";

/**
 * The one line every admin page begins with.
 *
 * The same shape as `requireCurrentPractice` and for the same reason: the
 * guard is written once, so there is no page that can be added later and
 * quietly be missing it. It is on the layout *and* on every child loader,
 * because React Router runs a parent's loader and its children's in
 * parallel — a guard on the layout alone stops the page rendering but does
 * not stop a child loader from having already read the rows.
 */

/**
 * The signed-in Admin, or a refusal that says nothing.
 *
 * A visitor with no session, a physician, a Member and a signed-in Admin
 * typing `/admin/librray` all get the same **404** — the page could not be
 * found. Not a redirect to sign-in, which would say *there is something here
 * and you are not it*, and not a 403, which says the same thing in a number.
 * The admin panel is at a guessable address on a public host, and the only
 * thing that can be kept from a stranger is whether it is there at all.
 *
 * Deliberately no message, no logging and no rate limiting: the refusal is
 * indistinguishable from a typo, and everything that would make it richer
 * would also make it answerable.
 */
export async function requireAdmin(
  services: AppServices,
  request: Request,
): Promise<SignedInUser> {
  const signedInAdmin = await getSignedInAdmin(services, request);

  // The same answer this app gives to every address it does not serve: the
  // body the root error boundary renders for a 404 says the page could not
  // be found and reads no differently here.
  if (!signedInAdmin) throw data(null, { status: 404 });

  return signedInAdmin;
}
