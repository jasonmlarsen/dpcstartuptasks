/**
 * The owner's own words, first person on purpose: it is one person asking, not
 * a company harvesting a list, and it is the persuasion that earns a tick
 * without a gate.
 *
 * It lives alone, in a module that imports nothing, because it is the one
 * thing in `email-consent.ts` a *component* reads — the sign-in form, the
 * Tailoring Wizard and Settings all print it beside their tick. Everything
 * else in that file is a write against the database, and the path from it to
 * `emailDigest` ends at `node:crypto`.
 *
 * Importing the sentence from there put that path into the browser's module
 * graph. The production build tree-shook it away and said nothing; Vite serves
 * a route module unshaken, so the dev browser evaluated the whole chain and
 * threw on `createHash` — which made the route module fail to load, and a
 * `<Link>` to Settings do nothing at all. A string with no imports cannot drag
 * a server module anywhere, which is why this is a file rather than a comment
 * asking callers to be careful.
 */
export const EMAIL_CONSENT_WORDING =
  "In order to keep this a free service to members, I would really " +
  "appreciate being able to communicate with you over email. You can still " +
  "unsubscribe at any time, and I will never sell or give away your email " +
  "address to anyone else.";
