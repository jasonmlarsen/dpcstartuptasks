/**
 * Free text made inert, for the one medium that has no sanitizer behind it.
 *
 * Every page in this product renders through React, which escapes what it
 * interpolates; an email does not. The HTML part of a message is a string
 * this app concatenates by hand, so a Display Name, a practice name or a
 * physician's complaint goes into it raw unless something does this — which
 * is why it is one function rather than one per email. A third composer
 * copying the chain a fourth time is how the day comes that one of them
 * forgets a character.
 *
 * Not the same as `app/lib/markdown.ts`'s escaping, which is deliberately
 * narrower: that one feeds a parser whose output is then sanitized, and this
 * one is the only guard there is.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
