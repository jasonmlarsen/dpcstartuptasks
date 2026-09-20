/**
 * What `?task=` carries, and how to read it back.
 *
 * A Task of either kind is named by one string: a Global Task by the slug it
 * was given at Seed, a Custom Task by `custom-<id>`. The prefix is what lets
 * the two kinds share one query parameter without a Practice's own Task ever
 * being able to shadow one in the Library — a Global slug never starts with
 * `custom-` followed by digits and nothing else, and even if one did, the
 * reader below is the only place that decides.
 *
 * One file rather than the rule spelled out wherever a ref is written or
 * read: the journey map writes these, and the Status and Note writes take
 * them back, and a disagreement between the three would be a Task that
 * opens and cannot be written to.
 */

/** A Custom Task's `?task=` value. */
export function customRef(id: number): string {
  return `custom-${id}`;
}

/**
 * The id inside a `custom-<id>` ref, or null for a Global Task's slug.
 * Null is not a failure: it is the answer *this names a Global Task*.
 */
export function customTaskIdIn(taskRef: string): number | null {
  const match = /^custom-(\d+)$/.exec(taskRef);
  return match ? Number(match[1]) : null;
}
