import { NavLink, Outlet } from "react-router";

import { requireAdmin } from "~/admin/admin-access";
import { getServices } from "~/services/services";
import type { Route } from "./+types/admin";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Admin — Launch Tasks" }];
}

/**
 * The admin panel's shell: one role, four flat sections, and no depth.
 *
 * It is inside the same app rather than beside it, because a second
 * deployment would mean a second copy of the schema, a second session
 * story and a second thing to keep running for an audience of one. What
 * keeps it separate is the guard, not the hostname.
 *
 * Four sections and no nesting: Practices, Library, System, Feedback.
 * Sub-navigation would be organising a panel that has eleven screens in it
 * at most, and the flat shape is what keeps the Practices list the page the
 * Admin lands on and checks.
 *
 * `AppBar` is deliberately not used here. It carries **Send feedback**,
 * which is a physician's item on a physician's page — the Admin is who
 * feedback goes *to*, and a panel that invited its operator to file some
 * would be a joke the code was not in on.
 *
 * There is no sign-out on this bar. The Admin signs in the same way
 * everyone else does, so signing out is where it is for everyone else, in
 * settings; a second one here would be a second control over the same
 * session.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const services = getServices(context);
  const admin = await requireAdmin(services, request);

  return { adminEmail: admin.email };
}

const SECTIONS = [
  { to: "/admin", label: "Practices", end: true },
  { to: "/admin/library", label: "Library", end: false },
  { to: "/admin/system", label: "System", end: false },
  { to: "/admin/feedback", label: "Feedback", end: false },
];

export default function AdminShell({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">
            Launch Tasks admin
          </h1>
          <p className="text-sm text-gray-600">{loaderData.adminEmail}</p>
        </div>

        <nav className="mx-auto flex max-w-4xl flex-wrap gap-6 px-6 pb-3">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                isActive
                  ? "text-sm font-semibold text-gray-900 underline"
                  : "text-sm text-gray-600 underline"
              }
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
