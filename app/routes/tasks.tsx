import { data, redirect } from "react-router";

import { firstPhaseSlug } from "~/practice/journey-map";
import { requirePracticeForList } from "~/practice/signed-in-practice";
import { getServices } from "~/services/services";
import type { Route } from "./+types/tasks";

/**
 * The door onto the journey map, which is never a screen of its own.
 *
 * A physician arriving without naming a Phase gets the first one. The Phase
 * in view lives in the URL rather than in a cookie or a column, so a link
 * into the middle of the list is shareable with the spouse doing the
 * paperwork and survives a reload.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  await requirePracticeForList(services, request);

  const first = firstPhaseSlug(services.database);
  // No Phases means an unseeded database, and there is no list to send
  // anyone to. Saying so beats redirecting into a URL that matches no route.
  if (!first) throw data("No phases", { status: 404 });

  throw redirect(`/tasks/${first}`);
}
