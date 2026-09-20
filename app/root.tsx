import {
  createContext,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import {
  rescueAdmin,
  supportViewInProgress,
  type SupportViewInProgress,
} from "~/admin/support-view";
import { SupportViewBanner } from "~/components/support-view-banner";
import { getServices } from "~/services/services";
import type { Route } from "./+types/root";
import "./app.css";

// No webfont link. `styles/design-tokens.css` sets `--font-sans` to a system
// stack, and a font request would be a round trip the parent site does not make.

/**
 * What the middleware found out about this request, for the loader to render.
 *
 * The two questions are asked once, at the top, and the answer is carried
 * rather than asked again: a loader that re-read the session would be a
 * second database read on every page view for a banner that is almost never
 * shown.
 */
export const supportViewContext = createContext<SupportViewInProgress | null>(
  null,
);

/**
 * The rescue, and it has to run here.
 *
 * A Support View can end at any instant — the hour, the Owner pressing
 * delete, the Purge — and the request that discovers it is usually the
 * Admin's next click. Middleware is the only place that runs **before any
 * route decides the request is unauthenticated** and, for a form post,
 * before the action: which is what makes *the action in flight is abandoned,
 * never replayed* true rather than aspirational (ADR-0001). A root loader
 * would be too late, because React Router runs the action first.
 *
 * Returning a `Response` short-circuits everything downstream, so the write
 * the Admin was attempting never happens. They land on the **Practices
 * list, never the Practice page** — after a deletion that page is gone — with
 * one sentence saying which of four things ended it.
 */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ context, request }, next) => {
    const services = getServices(context);

    const rescued = await rescueAdmin(services, request);
    if (rescued) {
      return redirect(`/admin?ended=${rescued.ending ?? "unknown"}`, {
        headers: rescued.headers,
      });
    }

    context.set(
      supportViewContext,
      await supportViewInProgress(services, request),
    );

    return next();
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  return { supportView: context.get(supportViewContext) };
}

/**
 * The banner lives here, above `children`, rather than in the route
 * component — because `Layout` is the one wrapper that renders for an error
 * page too.
 *
 * *For as long as it lasts* has to mean a 404 and a crash as well. Put it in
 * the route component and an Admin who mistypes an address, or opens the one
 * page Support View refuses, gets a bannerless screen with a borrowed
 * session still in their cookie jar — which is exactly the state the banner
 * exists to make impossible. The loader data is read rather than passed for
 * the same reason: during an error render there is no route component to
 * pass it through.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const supportView = useRouteLoaderData<typeof loader>("root")?.supportView;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {supportView && <SupportViewBanner view={supportView} />}
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
