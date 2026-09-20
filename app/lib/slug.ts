/**
 * The slug rule, in one place: lowercase, non-alphanumeric runs to a single
 * hyphen, trim.
 *
 * It lives here rather than in `app/seed/` because the journey map derives a
 * Phase's URL from its name with it, and nothing in the running app may route
 * to the Seed Script's directory — that separation is the whole of what keeps
 * the one dangerous capability in the system unreachable from a request.
 *
 * A Global Task's slug is generated once from its title at Seed and frozen
 * forever — the admin panel never lets it be edited, and the CSV has no slug
 * column for a typo to hide in. A collision is a hard error at Seed rather
 * than a silent `-2` suffix: in a hand-cleaned 98-row file, two titles
 * colliding almost certainly means a duplicated row, and that should be heard
 * about.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
