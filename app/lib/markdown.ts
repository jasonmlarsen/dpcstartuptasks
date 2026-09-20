import { Marked, marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Bodies, from Markdown to something safe to put on a page.
 *
 * A Global Task's Body is authored by the Admin, who is the operator of the
 * whole product, so raw HTML passes through the parser: the one field that
 * carries the value of a Task should not lose a table because the Admin
 * reached past Markdown for it. Passthrough is not trust, though — the HTML
 * is sanitized here, at render, against the allowlist below, so a Body that
 * arrived through a compromised admin session still cannot run anything.
 *
 * Anything a **Practice** wrote — a Custom Task's Body, and a Note when the
 * editor for one exists — is a different document with a different rule, and
 * gets `renderPracticeBody` instead: raw HTML is disabled *at the parser*,
 * not merely sanitized, and the allowlist is narrower. Two functions rather
 * than one with a flag, because the difference is whose words these are, and
 * a parameter is something a call site can get wrong.
 */

marked.use({ gfm: true, breaks: false, async: false });

/**
 * What an Admin-authored Body may contain once it has been parsed.
 *
 * Structure and emphasis, and nothing that can execute, load or position:
 * no `script`, no `style`, no `iframe`, no event handlers, and no `href`
 * scheme beyond the three a physician could have meant.
 */
const GLOBAL_BODY_ALLOWLIST: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "em", "del", "blockquote",
    "ul", "ol", "li",
    "code", "pre",
    "a",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // A link in a Body leaves the product, and the physician should keep their
  // place on the list. `noopener` is not optional once `target` is set.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer",
    }),
  },
  disallowedTagsMode: "discard",
};

/**
 * What a Practice-authored Body may contain.
 *
 * Structure and emphasis only. No `a`, because a physician writing a note to
 * themselves is not publishing, and no heading levels, because there is
 * nothing here long enough to need them.
 */
const PRACTICE_BODY_ALLOWLIST: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "del", "ul", "ol", "li", "code"],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
};

/** An Admin-authored Global Task Body, rendered and sanitized. */
export function renderGlobalBody(body: string): string {
  return sanitizeHtml(marked.parse(body) as string, GLOBAL_BODY_ALLOWLIST);
}

/**
 * A parser that will not emit HTML, whatever it is handed.
 *
 * Every `html` token — a block of markup, an inline tag — comes back out as
 * the text a physician typed. That is what *disabled at the parser* means
 * here, and it is stronger than sanitizing after the fact: the markup never
 * becomes markup, so widening the allowlist below could not let it through.
 */
const practiceParser = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
});

/** A Practice-authored Body, with raw HTML turned off at the parser. */
export function renderPracticeBody(body: string): string {
  return sanitizeHtml(
    practiceParser.parse(body) as string,
    PRACTICE_BODY_ALLOWLIST,
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The same Body as plain prose, for the snippet on a collapsed card.
 *
 * The card shows two lines, and the clamp to two is CSS — this only has to
 * make sure that what gets clamped reads as a sentence rather than as
 * `## Heading **bold**`. Markup is parsed and then thrown away, which is why
 * a Body written in raw HTML snippets as cleanly as one written in Markdown.
 */
export function bodyAsPlainText(body: string): string {
  const stripped = sanitizeHtml(marked.parse(body) as string, {
    allowedTags: [],
    allowedAttributes: {},
    // Block tags would otherwise run their neighbours' words together.
    textFilter: (text) => `${text} `,
  });

  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

/**
 * Undo the escaping the strip above leaves behind.
 *
 * The result is handed to React as text and escaped again on the way out, so
 * an `&amp;` left in place would reach the physician as `&amp;` — which is
 * the only reason this exists.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
