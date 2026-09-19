/**
 * The slug rule, in one place: lowercase, non-alphanumeric runs to a single
 * hyphen, trim.
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
