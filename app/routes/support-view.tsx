import { data, redirect } from "react-router";

import { stopSupportView, supportViewInProgress } from "~/admin/support-view";
import { getServices } from "~/services/services";
import type { Route } from "./+types/support-view";

/**
 * The banner's Stop button, and nothing else.
 *
 * It lives outside `/admin` because for the whole of a Support View the
 * Admin's session belongs to the Owner, and every address under `/admin`
 * answers them with the same 404 it answers a stranger with. The exit has to
 * be reachable from inside the borrowed account.
 *
 * There is no loader: nobody navigates here, and a `GET` is a 404 like any
 * other address this app does not serve. The guard is the view itself —
 * a request with no Support View in progress has nothing to stop.
 */
export async function action({ context, request }: Route.ActionArgs) {
  const services = getServices(context);

  const view = await supportViewInProgress(services, request);
  if (!view) throw data(null, { status: 404 });

  const headers = await stopSupportView(services, request, view);
  if (!headers) throw data(null, { status: 404 });

  // Back to the Practices list, which is where every exit from a Support
  // View lands — the Practice page is the one place the Admin must not be
  // left standing once they are themselves again.
  return redirect("/admin", { headers });
}
