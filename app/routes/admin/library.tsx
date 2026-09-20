import { requireAdmin } from "~/admin/admin-access";
import { getServices } from "~/services/services";
import { Stub } from "./stub";
import type { Route } from "./+types/library";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Library — Launch Tasks admin" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireAdmin(getServices(context), request);
  return null;
}

/** The Task Library: Drafts, publishing, Retiring, Phases, links, Dependencies (#37). */
export default function AdminLibrary() {
  return (
    <Stub heading="Library">
      Editing the Task Library — writing a Draft, publishing it to every
      practice, retiring a task, and moving phases, links and dependencies
      around — is not built yet.
    </Stub>
  );
}
