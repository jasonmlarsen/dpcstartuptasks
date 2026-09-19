# Seed data

Two files, and the difference between them is the point.

- **`dpc-enhanced-tasks-2026-starter-file.csv`** — the original spreadsheet
  export, byte-for-byte as it arrived. A record, not a source. Nothing reads
  it; it is here because git history is a poor archive — nobody greps a
  deleted file.
- **`task-library.csv`** — the cleaned file, and the only thing the Seed Script
  reads. 98 Tasks across 11 Phases.

The cleanup was a one-time editorial act, so it lives in the artifact rather
than in transform code (issue #11, decision 1). You review 98 rows and see the
product, instead of simulating a transform in your head.

## Columns

| Column | Meaning |
|---|---|
| `phase` | Phase name, with no ordinal. Phase order is first appearance; a Phase's `position` is never stored in its name. |
| `title` | The Task's title. The `slug` is derived from it at seed and frozen; the CSV has no slug column. |
| `body` | Markdown. |
| `state_specific` | `Yes` or `No`. |
| `depends_on` | The **title** of the one Task this usually comes after, or blank. Advice, never enforcement. |
| `helpful_links` | A JSON array of `{"label", "url"}`, in the order they should render. Blank means no links. **A blank label is a hard error at seed** — the label is what a physician reads, and there is no derivation path. |

`position` is not a column: a Task's position comes from its row order within
its Phase, and a Phase's from first appearance.

## What the cleanup did

Against the original's 117 data rows:

- Dropped the 11 blank separator rows.
- Cut Phase 12 / *Post-Launch* and its 7 Tasks. The list ends at Official
  Launch (#2, #11).
- Merged *Website Hosting* into *Website Maintenance*. 106 − 7 − 1 = **98**.
- Stripped the `Phase N: ` prefix from every phase name.
- Filled `state_specific = No` on the six rows that had it blank — *Join DPC
  Alliance*, *Domain Name*, *Practice Email System*, *IT - hire or manage
  in-house?*, *Website Maintenance*, *Office Supplies*. None is
  state-dependent.
- Dropped *SEO Setup*'s `PUT LINK TO ARTICLE HERE!!!!`. It seeds with no
  Helpful Link and gets one during the content pass.
- Added the label to each of the five real links.
- Rewrote two hand warts: *File Trade Name(s) / DBA…* became *File Trade
  Names / DBA…* so its slug does not carry a stray `-s-`, and *Domain Name*'s
  Body lost its `~$12-30/year` — cost guidance stays, the number to anchor on
  does not (#2).

## Columns deliberately dropped

`task_id`, `parent_task` (identical to `depends_on` in 105 of 106 rows),
`priority` (53 of 106 were "Critical"), `tags`, `cost_estimate` (cost guidance
goes in the Body, without a number), and `recurring` as a scheduling concept.

## Dependency edges

The original carries 68 single `depends_on` edges. Seven of them have a cut
Phase 12 Task as their source and one is *Website Hosting*'s duplicate of
*Website Maintenance*'s, so **60** survive into the cleaned file — the same 68
edges, minus the rows that no longer exist. No surviving Task depends on a cut
one, so the cut left nothing dangling. 19 of the survivors cross a Phase
boundary, which is tolerated; cycles are not.
