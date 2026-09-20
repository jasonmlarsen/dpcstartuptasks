import { redirect } from "react-router";

import { getSignedInUser } from "~/auth/server";
import type { AppServices } from "~/services/services";
import { practiceFor, type CurrentPractice } from "./practice";

/**
 * The two lines every page behind the door begins with, in one place.
 *
 * Session, then Membership, then the Practice — and never an id from the
 * request. Written once because every screen that ever renders a Practice's
 * work has to get this exactly right, and a preamble copied into each of
 * them is a preamble that can be copied slightly wrong.
 */

/** The signed-in User's Practice, or null if there is no session. */
export async function currentPractice(
  services: AppServices,
  request: Request,
): Promise<CurrentPractice | null> {
  const signedInUser = await getSignedInUser(services, request);
  if (!signedInUser) return null;

  return practiceFor(services.database, signedInUser.id);
}

/**
 * The same, for a page that has nothing to show without one.
 *
 * A visitor with no session is sent to the only door in the product. A
 * signed-in User with no Membership is sent to the landing page rather than
 * back to sign-in, because they are already signed in and a loop would be
 * the one response that tells them nothing.
 */
export async function requireCurrentPractice(
  services: AppServices,
  request: Request,
): Promise<CurrentPractice> {
  const signedInUser = await getSignedInUser(services, request);
  if (!signedInUser) throw redirect("/sign-in");

  const practice = practiceFor(services.database, signedInUser.id);
  if (!practice) throw redirect("/");

  return practice;
}
