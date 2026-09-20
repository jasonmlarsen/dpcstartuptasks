import { requireAdmin } from "~/admin/admin-access";
import { getServices } from "~/services/services";
import { Stub } from "./stub";
import type { Route } from "./+types/feedback";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Feedback — Launch Tasks admin" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireAdmin(getServices(context), request);
  return null;
}

/**
 * The Feedback inbox (#38). Physicians are already sending Feedback — the
 * box on every page has worked since #35 — so the rows are accumulating
 * behind this page, which is why it says so rather than saying nothing.
 */
export default function AdminFeedback() {
  return (
    <Stub heading="Feedback">
      The inbox is not built yet. Feedback sent from the product is being
      stored and is waiting here — up until its practice is purged, which
      takes its Feedback with it.
    </Stub>
  );
}
