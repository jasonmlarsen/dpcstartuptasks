import type { ReactNode } from "react";
import { Link } from "react-router";

import { MAIL_REPLY_TO } from "~/services/email-sender";

/**
 * The frame both legal documents render inside.
 *
 * They are routes rather than pages on the parent site because they have to
 * be readable from the sign-in screen *before* an account exists, and a
 * cross-domain hop at that moment is where a physician bails. Which means
 * this frame is one of the few that renders for someone with no session at
 * all: no appbar, no Send feedback, and a way back to the door.
 *
 * Versioning is the date and git, and nothing else. There is no version
 * column, no acceptance row, and deliberately no link to
 * `EMAIL_CONSENT_VERSION` — that version names the sentence one person
 * agreed to about email, and moving it when the Terms are reworded would
 * stop an old consent record meaning what it meant.
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated {lastUpdated}</p>

      <div className="mt-8 space-y-8">{children}</div>

      <p className="mt-12 border-t border-gray-200 pt-6 text-sm text-gray-500">
        <Link to="/sign-in" className="underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}

/** One titled section of a document. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </section>
  );
}

/**
 * The last section of both documents, and the same address in both.
 *
 * `MAIL_REPLY_TO` and not a second copy of it: this is the address a
 * physician's reply already lands on, and a legal document naming a
 * different one would be the first place that divergence showed.
 */
export function LegalContact() {
  return (
    <LegalSection heading="Getting in touch">
      <p>
        Write to{" "}
        <a href={`mailto:${MAIL_REPLY_TO}`} className="underline">
          {MAIL_REPLY_TO}
        </a>
        . A person reads it.
      </p>
    </LegalSection>
  );
}
