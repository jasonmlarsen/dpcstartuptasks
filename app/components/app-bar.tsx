import type { ReactNode } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "~/root";

/**
 * The bar across the top of every page behind the door.
 *
 * It exists for one reason: **Send feedback** has to be one press away from
 * wherever a physician noticed the thing that is wrong, and a header copied
 * into each route is a header one route will quietly be missing. Each page
 * still says what it says on the left and keeps its own links on the right;
 * the feedback item is the part no page gets to decide about.
 *
 * The page and the Task travel with the press and nobody types them. The
 * link carries `from` — the address in the browser, query string and all,
 * because `?task=` is where the open Task lives — and `task` alongside it,
 * read from the same place the drawer reads it. `useLocation` is how this
 * works with no client JS at all: it is the server's own view of the URL
 * during the render, so the link is already correct in the HTML.
 *
 * The item suppresses itself on the feedback page, which is the one page
 * where it would lead where the physician already is.
 *
 * It suppresses itself a second time for the whole of a **Support View**, so
 * that the Admin can never file a Feedback in the Owner's name:
 * `sendFeedback` takes its author from the session, so an Admin pressing
 * this item inside a Practice would write the Owner's id onto the row. The
 * flag is read off the root loader rather than passed down, because the bar
 * appears on four pages and a prop is a prop one of them would forget; the
 * page itself refuses the same request, since a hidden link is not the same
 * promise as *never*.
 */
export function AppBar({
  title,
  width = "max-w-3xl",
  children,
}: {
  title: string;
  /** The page's own column width, so the bar lines up with what is under it. */
  width?: string;
  /** Whatever else this page puts on the right, before the feedback item. */
  children?: ReactNode;
}) {
  const location = useLocation();
  const onFeedbackPage = location.pathname === "/feedback";
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const inSupportView = root?.supportView != null;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div
        className={`mx-auto flex ${width} flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-6 py-4`}
      >
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        <div className="flex items-baseline gap-4">
          {children}
          {!onFeedbackPage && !inSupportView && (
            <Link
              to={sendFeedbackLink(location.pathname, location.search)}
              className="text-sm text-gray-600 underline"
            >
              Send feedback
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Where the item points, carrying the page and the open Task silently. */
function sendFeedbackLink(pathname: string, search: string): string {
  const taskRef = new URLSearchParams(search).get("task");

  const carried = new URLSearchParams({ from: pathname + search });
  if (taskRef) carried.set("task", taskRef);

  return `/feedback?${carried}`;
}
