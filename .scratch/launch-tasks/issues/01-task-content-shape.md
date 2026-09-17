# Task content shape: which fields survive, and what a physician actually sees

Type: grilling
Status: open
Blocked by: —
Map: ../map.md

## Question

The starter CSV (`dpc-enhanced-tasks-2026-starter-file.csv`) is a rough draft: 106 tasks across 12 phases, with columns `task_id`, `depends_on`, `task_name`, `parent_task`, `phase`, `priority`, `tags`, `notes`, `helpful_links`, `state_specific`, `cost_estimate`, `recurring`. The owner has said it may be narrowed or simplified.

Decide the final content shape before anything else is designed:

1. **Which columns survive into the product?** `priority` (Critical/Important/Nice to Have) and `tags` (10+ values) may be redundant with `phase` — three overlapping taxonomies on 106 items is a good way to overwhelm someone. `cost_estimate` is inconsistent (some blank, some `$0 `, some ranges) and needs a decided format. `parent_task` duplicates `depends_on` in most rows — is the hierarchy real or an artifact?
2. **Is 106 the right number?** Some tasks are near-duplicates or could merge (`Website Hosting` / `Website Maintenance`). Some Phase 12 post-launch items may belong to a different product entirely.
3. **What does a single task show a physician?** Name, phase, notes, links, cost, "usually comes after X", state-specific warning — in what priority order, and what is hidden until asked for?
4. **What is the authoring format for `notes` and `helpful_links`?** Plain text, Markdown, or structured? The owner wants to put links and helpful information inside notes via the admin panel, so this determines the admin editor and the renderer.
5. **Data quality:** several rows have empty trailing columns, one row has a literal `PUT LINK TO ARTICLE HERE!!!!` placeholder, and phase separator rows are blank. Decide whether cleanup happens before or during import.

This ticket blocks the UX prototype and the schema — both need to know what a task *is*.

## Notes for the session

Read the CSV in full before grilling. Come with a concrete proposed column set and a concrete proposed task count, not open questions.
