/**
 * Where a Helpful Link goes, and what to say beneath its label.
 *
 * A URL that is missing, unparseable, or not something a browser should
 * navigate to gets no `href` at all. The drawer renders `no link set` for
 * those and does not make them clickable — a content gap that is visible
 * beats a link that breaks.
 *
 * It lives here rather than in the journey map because the admin panel shows
 * the derived domain **live** while the Admin types the URL, and the domain a
 * physician reads and the domain the Admin is shown have to be the same
 * derivation — two spellings of this rule would mean the Admin proof-reading
 * a link against a domain the drawer would not print.
 */
export interface LinkDestination {
  href: string | null;
  domain: string | null;
}

export function destinationOf(url: string): LinkDestination {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { href: null, domain: null };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { href: null, domain: null };
  }

  return {
    href: parsed.href,
    domain: parsed.hostname.replace(/^www\./, ""),
  };
}
