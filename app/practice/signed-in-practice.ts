import { redirect } from "react-router";

import { getSignedInUser } from "~/auth/server";
import type { AppServices } from "~/services/services";
import { practiceFor, type CurrentPractice } from "./practice";
import { tailoringOwed } from "./tailoring";

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

/**
 * The same again, for the two screens that are the list itself.
 *
 * The Tailoring Wizard sits in front of the journey map and nowhere else, so
 * the gate is here rather than on the Continue press: closing the tab
 * half-way through is not an answer, and a Wizard that were owed only at the
 * moment of signing in would be lost by anyone who did. It is owed until it
 * is answered or skipped, and it is asked at the one door it belongs in
 * front of.
 *
 * A Member and a Practice already in flight never meet it — `tailoringOwed`
 * is where that is decided, and this function has no opinion of its own.
 */
export async function requirePracticeForList(
  services: AppServices,
  request: Request,
): Promise<CurrentPractice> {
  const practice = await requireCurrentPractice(services, request);

  if (tailoringOwed(services.database, practice)) throw redirect("/welcome");

  return practice;
}
