import { requireAdmin } from "~/admin/admin-access";
import { getServices } from "~/services/services";
import { Stub } from "./stub";
import type { Route } from "./+types/system";

export function meta(_: Route.MetaArgs) {
  return [{ title: "System — Launch Tasks admin" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireAdmin(getServices(context), request);
  return null;
}

/** Kit queue health, which arrives with the Kit Sync Jobs themselves (#41). */
export default function AdminSystem() {
  return (
    <Stub heading="System">
      The health of the Kit sync queue is not built yet — there is no queue to
      report on until the sync jobs exist.
    </Stub>
  );
}
