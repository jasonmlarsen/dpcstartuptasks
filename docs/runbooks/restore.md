# Restore runbook

The operator's procedures for getting data back. Two different things live
here and they should not be confused:

1. **Restoring a Practice inside its Grace Period** — a physician deleted
   their own practice and has asked for it back. Nothing is missing; the
   database is fine. This is the whole of the procedure below, and it is the
   only part written so far.
2. **Restoring the database** from Litestream or the daily cold copy, the
   monthly drill, and the Scrub script that is the default path into a cold
   copy. Those belong to the deploy and backups ticket (#45) and are not
   written yet.

---

## Restoring a Practice inside its Grace Period

**When:** an Owner pressed *Delete this practice* and has asked, within
thirty days, for it back.

**Why this is a manual step.** The confirmation dialog promises that the
practice is permanently deleted after thirty days and that we can bring it
back before then. In v1 that promise is honoured by the operator editing the
database by hand. This is a **named gap, accepted deliberately**, not an
oversight: a self-serve undo would be a second control on the most dangerous
act in the product, and an admin screen for it would be a screen that exists
for an event that may never happen. The Feedback Digest is what makes the
window real — the Admin hears from a physician inside the same thirty days.

**Do not let the window lapse.** After the Purge there is nothing to
restore in the live database; recovery then means a database restore from a
backup taken before day 30, which is a different and much larger procedure.

### The state you are restoring from

Deleting sets exactly one column and destroys nothing:

- `practice.deleted_at` is set to the moment of the press.
- Every session of every User in that Practice was ended first.

Memberships, Task Entries, Notes, target dates, Custom Tasks, outstanding
Invites and every User are all still there, untouched.

### Steps

1. **Confirm the request came from the Owner.** The only person who can have
   deleted it is the Owner, and their email address is on the `user` row
   joined through `membership` where `role = 'owner'`. Reply to the address
   on file rather than to whatever address wrote in.

2. **Take a copy of the database file before touching it.** The daily cold
   copy is not enough on its own — it may be up to a day old.

3. **Find the Practice.** Deleted ones are the only rows with a
   `deleted_at`:

   ```sql
   SELECT p.id, p.name, p.deleted_at, u.email
   FROM practice p
   JOIN membership m ON m.practice_id = p.id AND m.role = 'owner'
   JOIN user u ON u.id = m.user_id
   WHERE p.deleted_at IS NOT NULL;
   ```

4. **Check it is still inside the window.** `deleted_at` must be less than
   thirty days ago. If it is not, stop: the Purge either has run or is due,
   and this is no longer this procedure.

5. **Clear the column.**

   ```sql
   UPDATE practice SET deleted_at = NULL WHERE id = <id>;
   ```

   That is the whole restore. Nothing else was changed by the delete, so
   nothing else has to be changed back.

6. **Tell them to sign in again.** Their sessions were ended at the moment
   of deletion and are not coming back; the next Sign-in Link works
   normally, and the list is exactly as they left it.

7. **Record it** — the date, the Practice, who asked, and when they were
   told — wherever operator actions are kept. This is an operator acting on
   a physician's data outside the product, and it should be as visible after
   the fact as a Support View session is.

### What you must not do

- **Do not clear `deleted_at` on a Practice nobody asked about.** A deleted
  Practice is unreachable to everyone in it on purpose; un-deleting one
  quietly puts a list back in front of people who were told it was gone.
- **Do not delete rows to "clean up" a Practice you have restored.** Nothing
  was orphaned by the delete.
