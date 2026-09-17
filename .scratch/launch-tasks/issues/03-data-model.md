# Data model: global library, per-practice overrides, and members

Type: grilling
Status: open
Blocked by: 01
Map: ../map.md

## Question

The content model is settled in principle — a live global task library plus per-practice overrides — but the schema that expresses it is not. Drizzle schema in TypeScript, SQLite. Pin down:

1. **The override table.** A practice's relationship to a global task carries status, private notes, target date, N/A, and a "seen this is new" marker. Is that one row per (practice, global task) created lazily on first interaction, or eagerly at signup? Lazy keeps the table small; eager makes queries simpler.
2. **Ordering.** Practices can reorder. Global tasks have an inherent order, custom tasks are inserted by the practice, and new global tasks arrive later. How do these interleave without a full re-index on every insert, and what happens to a practice's manual order when a new global task lands?
3. **Custom tasks.** Practice-owned tasks live alongside global ones. Same table with a nullable `global_task_id`, or a separate table unioned at read time? This choice shows up in every query in the app.
4. **New-task flagging.** Per-practice seen-tracking so "3 new tasks added" can be shown. Where does that live, and how is it cleared?
5. **Identity and membership.** User, Practice, membership with Owner/Member roles, the 3-user cap, and the invite lifecycle (pending, accepted, revoked). What happens when an invited email already belongs to another practice?
6. **Consent record.** The checkbox is simple, but decide what is stored: at minimum a timestamp and the wording agreed to, plus Kit sync state.
7. **Soft delete vs hard delete** for practices and tasks, and what the admin can see of a deleted practice.

## Notes for the session

Call `grilling` and `domain-modeling`. Write the resulting vocabulary into `CONTEXT.md` as terms are settled — this ticket is where the project's nouns get fixed.
