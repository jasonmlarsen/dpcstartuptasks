# Admin panel: what the owner can change, and how changes reach practices

Type: grilling
Status: open
Blocked by: 03
Map: ../map.md

## Question

The owner wants to update tasks globally — including links and helpful information in the notes — and have those updates reach physicians already working through their lists. Decide the surface:

1. **What is editable?** Task name, notes, links, phase, dependencies, cost, state-specific flag. Can the owner reorder the global library, add tasks, and retire tasks? **What happens to a practice's progress when a global task is retired** — is it deleted, archived, or does it stay for practices that already interacted with it?
2. **The notes editor.** Follows from ticket 01's authoring format. Markdown with a preview is the likely answer, but the link-insertion experience is the part the owner will use most.
3. **Is there a draft/publish step,** or do edits go live immediately? Live is simpler; a typo is then visible to 50 practices instantly.
4. **What does the owner see about practices?** Email list for export to Kit, signup dates, consent status, aggregate progress. Deliberately decide what is *not* visible — a practice's private notes should almost certainly be off-limits, and saying so explicitly is worth more than leaving it undefined.
5. **Admin authentication.** Same magic-link flow with an admin flag, or a separately protected surface? There is exactly one admin.
6. **Bulk operations.** Importing the CSV is one-time, but editing 20 links one at a time is painful. Is there a bulk edit path?

## Notes for the session

Read resolved ticket 03 first — the admin surface is largely a read/write view of that schema.
