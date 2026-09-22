# Seed data

Two files, and the difference between them is the point.

- **`dpc-enhanced-tasks-2026-starter-file.csv`** — the original spreadsheet
  export, byte-for-byte as it arrived. A record, not a source. Nothing reads
  it; it is here because git history is a poor archive — nobody greps a
  deleted file.
- **`task-library.csv`** — the cleaned file, and the only thing the Seed Script
  reads. 98 Tasks across 11 Phases. The Export Script writes it back.

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

## Editing before launch

The admin panel is the editor, and this file is the artifact. Both are true at
once, which is what the Export Script is for.

Edit in the panel rather than in the cells: a Body is markdown that a
physician reads, and proof-reading it inside a quoted CSV cell — where a
comma needs escaping and a Helpful Link is a JSON array on one line — is how
a typo survives to launch. Edit in `/admin/library`, then write the pass back
out.

```sh
npm run db:export                                  # rewrites task-library.csv
npm run db:export -- --database /tmp/content.sqlite
npm run db:export -- --out /tmp/review.csv         # somewhere else, to read first
```

It overwrites this file in place, because **git is the review**. The diff of a
content pass is the reason to run it, and a CSV written safely to one side is
a CSV somebody forgets to move.

Exporting a freshly seeded database reproduces this file byte for byte, and
`test/export.test.ts` asserts exactly that against the committed copy. That
round-trip is the whole contract: a diff after a content pass shows the
sentences you changed and nothing else.

### What an export refuses, and what it leaves out

Anything the CSV cannot represent is a refusal rather than a quiet omission —
a silently dropped row is a Task that never reaches production and is noticed
by nobody until a physician asks where it went.

| Situation | What happens |
|---|---|
| A Task with two Dependencies | **Refused**, naming both. The panel's picker allows several predecessors; `depends_on` holds one, and only the Admin can say which survives. |
| A Dependency on a Task that is not Published | **Refused.** The CSV would name a row that is not in it. |
| Nothing Published at all | **Refused.** A CSV of nothing seeds every Practice an empty list. |
| A Draft Task | Left out, and named on the way out. The CSV has no state column — a Seed publishes everything it reads. |
| A Retired Task | Left out, and named. Retire *is* the delete key during a content pass. |
| A Phase with no Published Tasks left | Absent from the file. Phase order is first appearance, so there is no Phase row left behind. |

### One thing to know about slugs

A slug is derived from the title at seed and then frozen. Rename a title in
the panel and the development database keeps the old slug, but the export
writes the new title and a fresh production Seed derives a new slug from it.

Before launch that is harmless — no link or bookmark to a Task exists yet.
After launch it is not, which is what retire-and-replace is for.

## Publishing to production

The content pass happens on a development database; production is built from
the committed CSV. In order:

1. **Edit** in `/admin/library` against a development database, until the
   list reads the way it should.
2. **Export** with `npm run db:export`, and read the diff. Note anything the
   run said it left out.
3. **Re-seed a scratch database from the exported file and open it** —
   `rm data/launch-tasks.sqlite*` then `npm run db:seed`, then `npm run dev`.
   This is the step worth not skipping: it is the only way to see the file
   the way production will, with slugs derived fresh from the titles you just
   edited. A Seed that refuses tells you here rather than on the VPS.
4. **Commit** `docs/seed/task-library.csv`. This is the release: the file in
   git is what production will hold.
5. **Seed production from a checkout**, never from inside the container —
   clone, `npm install`, and point `--database` at the Coolify volume's file:

   ```sh
   npm run db:seed -- --database /data/launch-tasks.sqlite
   ```

6. **Promote an Admin** with a SQL statement on the VPS
   (`update user set role='admin' where email='…'`), and from then on the
   admin panel is the way a Body is fixed. An edit typed there is on every
   Practice's list immediately, with no deploy and no re-seed.

After step 5 the direction of travel reverses for good. `seed()` refuses a
database that already holds Tasks, so there is no path by which this file
re-enters production — the export becomes a reporting tool, and the live
Library becomes the source of truth. That asymmetry is deliberate: the
dangerous direction stays impossible.
