---
status: accepted
---

# Two content tables, and Task Entries that always exist

A **Global Task** and a **Custom Task** live in separate tables, not in one table with a nullable `practice_id` distinguishing them. They are brought together in a single loader at read time.

A **Task Entry** — a Practice's row for one Task, carrying Status, Note and target date — exists for **every** Task from the moment a Practice is created, and for every Task from the moment it is Published. It is never created lazily on first touch, so the absence of an Entry never means anything.

## Why

### Two tables

The single-table shape is the textbook one, and it is wrong here for a specific reason: it makes **every** query against task content a tenancy-sensitive query. A Global Task row and another Practice's Custom Task row would sit side by side, distinguished only by a column, and correctness would rest on every future `SELECT` remembering `WHERE practice_id IS NULL OR practice_id = ?`. That is one forgotten clause away from showing a physician another practice's private work — in a product whose whole content is a competitor's business plan, written by someone who has no idea they are a competitor.

Separate tables convert that from a discipline into a fact about the schema. A query against `global_task` cannot leak a Practice's data, because no Practice's data is in it. The risk does not have to be remembered; it does not exist.

The merge cost is what usually kills this shape, and here it is small. The task list screen loads **one Phase at a time**, so there is exactly one read path where the two sets have to be combined, and it combines around a dozen rows. The cost is one loader, written once.

The two types are also genuinely different, which is the tell that they were never one table pretending. A Custom Task has no Helpful Links, no Dependencies and no state flag — those are editorial acts, and a physician is not an editor. A single table would have carried three columns that are always null for half its rows.

### Entries that always exist

At the scale this product expects — roughly 50 Practices, 98 Tasks — the entire Task Entry table is about **4,900 rows**. That number is small enough that materialising every Entry costs nothing, and it buys the removal of an entire category of ambiguity.

If Entries were created on first touch, every read would have to answer "does no row mean *not started*, or *never rendered*, or *Task published after this Practice existed*?" — and every one of those questions would have to be answered again at each new call site. Making the row unconditional collapses all of them into ordinary columns on a row that is always there. Several decisions elsewhere are only simple because of it:

- **Newly Added** is `announced_at IS NOT NULL AND acknowledged_at IS NULL`, not an inference from a missing row.
- **Retiring** a Global Task can hard-delete the Entries of Practices that did nothing and keep the rest marked *No longer required*, because "did nothing" is a readable state rather than an absence.
- **Publishing** is a single backfill, and un-retiring is the same backfill again — which is what makes retire-and-replace safe.

This also settled a naming problem. The row was going to be called an **Override**, which was only ever accurate while it appeared on change. Once it exists unconditionally the word is a lie about the thing, so the row is a **Task Entry** and *Override* keeps its proper meaning: the concept of the Practice-owned layer over the Admin-owned Task Library.

## Considered and rejected

- **One table with a nullable `practice_id`.** Fewer tables, one query, no merge. Rejected on the leak argument above: it makes tenancy a property of every query rather than of the schema, permanently, for a saving that amounts to one loader function.
- **Lazily-created Task Entries.** The conventional optimisation, and at four orders of magnitude more Practices it would be the right one. Rejected because at this size it trades away a load-bearing invariant to save a few thousand rows in a file that is already smaller than a photograph.
- **A single table with a discriminator column and a check constraint** enforcing that Custom rows carry no links or dependencies. Rejected as the worst of both: the tenancy exposure of one table plus constraint machinery to re-impose the difference the two tables express for free.

## Consequences

- **Publishing a Global Task writes one row per Practice.** Fine at 50 Practices, and it stays fine for a long time; it is a linear cost that arrives on a deliberate admin action, not on a physician's page load. At tens of thousands of Practices this becomes a background job rather than a request.
- **The cheap merge depends on the one-Phase-at-a-time read path.** If a screen ever needs all 98 Tasks at once — a global search, an export, a cross-Practice report — the merge is paid at that size too, and it has to be written a second time. That is the point at which this decision is worth re-examining, and the only one.
- **Custom Tasks can never gain Helpful Links, Dependencies or the state flag without a schema change.** This is intended: those are the editorial acts that mark the boundary between the Task Library and a Practice's own work.
- **Deleting a Practice must purge its Entries**, and there are ~98 of them per Practice. The soft-delete-then-purge path owns this.
- **Anything that reads a Task Entry may assume it exists.** Code that defends against a missing Entry is either dead or a symptom of a bug in the backfill, and should be read as the latter.

Full reasoning and the rest of the data model: [issue #4](https://github.com/jasonmlarsen/dpcstartuptasks/issues/4).
