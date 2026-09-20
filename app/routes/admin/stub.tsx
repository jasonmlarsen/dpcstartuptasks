import type { ReactNode } from "react";

/**
 * A section that exists so the shell has four of them.
 *
 * Library, System and Feedback are each a ticket of their own, and an empty
 * page would read as a bug on a panel whose whole job is telling the
 * operator what is going on. So each says what it will be and that it is
 * not built — which is also what stops a half-finished screen from being
 * quietly shipped under one of these headings.
 */
export function Stub({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-gray-900">{heading}</h2>
      <p className="mt-2 text-gray-700">{children}</p>
      <p className="mt-4 text-sm text-gray-600">Not built yet.</p>
    </section>
  );
}
