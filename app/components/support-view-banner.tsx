import { Form } from "react-router";

import type { SupportViewInProgress } from "~/admin/support-view";

/**
 * The band across the top of every page for as long as a Support View lasts.
 *
 * **Not dismissible, and there is no control here that could make it go
 * away** except the one that also ends the view. Support View is writable
 * (ADR-0001), so a write made inside it is indistinguishable from the
 * physician's own — this is the mitigation, and a banner that could be
 * closed would be no mitigation at all.
 *
 * It names the Practice, because *whose list am I typing into* is the only
 * question it exists to answer, and the Admin may have opened several tabs.
 *
 * Stop is a plain form at zero client JS, like every other load-bearing
 * control in this product. It posts to a route of its own rather than to
 * anything under `/admin`, because while the view lasts the Admin's session
 * is the Owner's and every admin address answers 404 to them.
 */
export function SupportViewBanner({ view }: { view: SupportViewInProgress }) {
  return (
    <div className="border-b border-amber-300 bg-amber-100">
      <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-6 py-3">
        <p className="text-sm font-semibold text-amber-950">
          Support view — you are acting as the owner of{" "}
          {view.practiceName ?? "an unnamed practice"}. Anything you do here is
          recorded.
        </p>

        <Form method="post" action="/support-view">
          <button
            type="submit"
            className="text-sm font-semibold text-amber-950 underline"
          >
            Stop
          </button>
        </Form>
      </div>
    </div>
  );
}
