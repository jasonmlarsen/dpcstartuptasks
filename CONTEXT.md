# Launch Tasks

A free, multi-tenant web app that walks a physician through starting a Direct Primary Care practice as a task list. Its audience is physicians, not software users; many are opening their first business.

## Language

### Tenancy

**Practice**:
One clinic and its shared task list. The unit of tenancy — an account *is* a practice.
_Avoid_: Account, tenant, organization, workspace

**Owner**:
The single member of a Practice who can invite, remove, and delete. Exactly one per Practice.
_Avoid_: Admin (that word is taken), co-owner, primary user

**Member**:
Someone with access to a Practice's task list who is not the Owner. Up to two per Practice. Can do anything on the list itself.
_Avoid_: Collaborator, team member, user

**Admin**:
The operator of the whole product, who edits the Task Library for every Practice and can enter a Practice through Support View. Not a role within a Practice.
_Avoid_: Superuser, staff

**Support View**:
The Admin looking at a Practice exactly as its Owner sees it, in order to help them. Shows everything the Owner can see, including Notes, and can act as they would. Always announced by a banner for as long as it lasts. Only ever aimed at an Owner, never at a Member. The Send feedback item is hidden for its duration, so the Admin can never file a Feedback in the Owner's name. It ends when the Admin stops it, when its hour runs out, or the instant the Owner's own access ends — deleting a Practice takes the Admin's view of it away too, and a Practice in its Grace Period cannot be entered at all.
_Avoid_: Impersonation (what the library calls it, not what it is for), god mode, sudo, shadowing

**Display Name**:
The one free-text name a User has, with their email address as the fallback everywhere it is missing. An Owner is asked for theirs at the moment they first invite someone, because an invitation has to come from a person; a Member types theirs on the acceptance screen. Never synced to Kit, and the email address beside it is never editable.
_Avoid_: Full name, profile, username

**Membership**:
The link between a User and the one Practice they belong to, carrying their role of Owner or Member. A User belongs to exactly one Practice.
_Avoid_: Seat, role assignment, affiliation

**Invite**:
An Owner's outstanding offer of a Membership to an email address. Counts against the Practice's three-person cap while it is pending, so acceptance can never breach the cap.
_Avoid_: Invitation link, request, pending user

### Signing in

**Sign-in Link**:
The single-use link emailed to a User to let them in. The only way into the product — there is no password, so a Sign-in Link that fails is not a degraded experience but a locked door. It lives for ten minutes, works once, and is used up by pressing Continue on the Continue Screen, never by being fetched. Every request for one is answered the same way whoever asked and whatever address they typed, because the answer is the only place an address could ever leak.
_Avoid_: Magic link (the library's word, and no physician's), login link, token, one-time password

**Continue Screen**:
The page a Sign-in Link opens, carrying a single Continue button and nothing else. It exists because corporate mail systems open links before their owner does, and a link that signed you in merely by being opened would already be spent by the time the physician clicked it. Opening it does nothing at all — it looks the same for a good link, an expired one and a forged one, and only pressing Continue finds out which it was.
_Avoid_: Interstitial (what it is, not what it is for), confirmation page, verification page

### Content

**Task Library**:
The single live, global set of Tasks that the Admin owns. Edits reach Practices already in flight.
_Avoid_: Template, catalog, master list

**Task**:
One thing a physician must do to open a practice. The unit the whole product is built around.

**Global Task**:
A Task belonging to the Task Library. Carries `title`, `phase`, `body`, `state_specific`, `helpful_links[]`, `depends_on[]`.
_Avoid_: Library task, standard task, default task

**Custom Task**:
A Task a Practice created for itself. Deliberately lighter than a Global Task: no Helpful Links, no Dependencies, no state flag — those are editorial acts, and a physician is not an editor.
_Avoid_: User task, personal task, ad-hoc task

**Phase**:
An ordered grouping of Tasks ("Foundation & Planning", "Credentialing & Compliance"). Its number is derived from its position and is never part of its name.
_Avoid_: Stage, section, category, milestone

**Body**:
The help text on a Task, authored in Markdown. Since no other descriptive field survives, the Body *is* the value of a Task.
_Avoid_: Note (that word means the Practice's own writing on a Task), description, details

**Helpful Link**:
A curated, labelled link on a Global Task. The label is always present and is what a physician reads; a bare URL is a bug.
_Avoid_: Resource, reference, URL

**Dependency**:
A statement that one Task usually comes after another. Advice, never enforcement — nothing in the product is ever locked.
_Avoid_: Prerequisite, blocker, gate

**Seed**:
The one-time load of the Task Library into an empty database, from the cleaned starter CSV. The original spreadsheet is a record, not a source: once a database has been seeded, everything after that is the Admin's editing. Seeding never deletes anything, so a database that already holds Tasks is simply refused.
_Avoid_: Upload, import, reset (the product has no power to clear a database; a person discards a file and seeds a fresh one)

**Seed Script**:
The command-line tool that performs a Seed. Knows only about Phases, Tasks and Helpful Links — it cannot create a Practice, a User or a Membership, which is what makes it safe to point at a production database. Dummy accounts for development come from a separate tool that goes through registration and invites like anyone else.
_Avoid_: Importer, migration (migrations change shape, a Seed adds content)

### A Practice's own work

**Status**:
Where a Practice has got to on one Task: not started, in progress, done, or not applicable.

**Not Applicable**:
A Status meaning this Task will never apply to this Practice. Stops counting against progress — the state that makes the list feel achievable rather than accusatory. It sinks to the bottom of its Phase and dims to its title alone; it never disappears, because a Practice must always be able to see what it set aside and change its mind.
_Avoid_: N/A as a stored value, skipped, dismissed, hidden

**Note**:
A Practice's own writing on a Task, belonging to the Practice rather than to whoever typed it — a Member who Leaves does not take their Notes with them. Never visible to another Practice, and never authored in raw HTML. Visible to the Admin in Support View — the word *private* was dropped on purpose when that was decided, rather than left standing as a promise the product no longer keeps, and the Note field carries a quiet line saying so.
_Avoid_: Private Note, Custom Note (*Custom* means authored by a Practice rather than the Admin, and there is no Admin-authored note for it to contrast with), comment, annotation

**Task Entry**:
A Practice's row for one Task, carrying its Status, Note and target date. Exists for every Task from the moment a Practice is created, not only once the Practice has touched it — so "no Entry" never means anything.
_Avoid_: Override (it is not only present when something changed), progress record, task instance

**Override**:
The *concept* of the Practice-owned layer sitting on top of the Admin-owned Task Library. The thing that holds it is a Task Entry. A Practice may never rename or rewrite a Global Task's Body.
_Avoid_: using this word for the row itself — that is a Task Entry

**Newly Added**:
A Global Task published after a Practice already existed, flagged to that Practice until someone there opens it. Tasks present when the Practice was created are never Newly Added.
_Avoid_: Unread, unseen, updated

**Retired**:
A Global Task the Admin has withdrawn from the Task Library. Never deleted, because Practices have Task Entries against it and may already have done the work. It disappears for Practices that never touched it, and stays — marked `No longer required`, and no longer counting either way towards progress — for Practices that did, rendered exactly as a Not Applicable Task is but without a Status control, because un-retiring is the Admin's act and not the Practice's. A Practice is never Retired; a Practice is deleted, then purged.
_Avoid_: Deleted, archived, disabled

**Draft**:
A Global Task the Admin is still writing. Exists only in the admin panel: no Practice has a Task Entry for it, so it is not merely hidden — it is not yet part of anyone's list.
_Avoid_: Unpublished, hidden, private, work in progress

**Published**:
A Global Task released into the Task Library, which is the moment every Practice gains a Task Entry for it. Publishing is a deliberate act; editing an already-published Task is not, and reaches Practices on save.
_Avoid_: Live, released, active

**Tailoring Wizard**:
One screen of three questions, shown once to a Practice's Owner after their first login, which sets the Tasks a Practice will never need to Not Applicable. Skippable, and gone forever either way — a Member never sees it. It only ever sets a Status: it hides nothing, so a Practice that answers wrongly loses nothing.
_Avoid_: Onboarding (it happens after the account exists and is not required), setup flow, survey, quiz

**Practice Profile**:
What a Practice told the Tailoring Wizard: its state, whether it sees patients at a fixed location, and whether it expects employees. Kept after the Wizard has done its work, for wording and for segmenting email — never re-applied to Tasks published later.
_Avoid_: Onboarding answers, preferences, settings

### Feedback

**Feedback**:
One thing a physician told the Admin was wrong, sent from a text box reachable on every page. It is a message, not a case: it carries the text, the page it was sent from and the Task the physician was looking at, and it has exactly two states — **New** until the Admin has finished with it, then **Done**, optionally with a one-line note recording what changed or why nothing did. There is no reply in the product; the Admin has the address and writes back by hand if it is worth it. A Feedback is never deleted and never expires — only a Purge destroys one, along with everything else its Practice wrote.
_Avoid_: Ticket, support request, report, issue, bug — each promises a system that is not being built

**Feedback Digest**:
The once-daily email listing the Feedback that arrived since the last one, sent to the Admin's own address and never sent empty. It is what makes the thirty-day Grace Period a real window rather than a hope that someone remembers to open a page, which is why removing it would quietly change what Purge costs.
_Avoid_: Notification, alert, summary email

### Consent

**Email Consent**:
A User's permission to be sent occasional non-transactional email. Asked at registration as a checkbox ticked by default, offered once more on a dismissible card at the end of the Tailoring Wizard to a User who declined, and grantable later from settings by a User who still has not — never a condition of using the product, since Launch Tasks is free and stays usable whether or not it is given. Three asking points and no fourth: the card is on a screen seen once per Practice and gone, and there is nothing on the task list, because a card a physician who said no meets every morning is a nag rather than an offer. Consent is **append-only**: the app can record that it was given, never that it was withdrawn. It is therefore a record of an act, not a statement of current state — a User who consented and later used an email's unsubscribe link still has Email Consent recorded, and the app does not know.
_Avoid_: Subscription (that is Kit's word for its own state), opt-in, marketing permission

**Cancelled**:
Kit's word, used unchanged, for a subscriber who has unsubscribed. Kit treats it as permanent and consent-revoking, and so does Launch Tasks: once Kit reports a subscriber Cancelled, the app writes nothing further about them — not the subscriber, not the tag, not the Practice State field. Only the physician can leave this state, through a Kit-hosted resubscribe form that the app links to and does not operate.
_Avoid_: Unsubscribed (fine in prose, but the value the API returns is `cancelled`, and code should match it), opted out, bounced (a different Kit state entirely)

**Suppressed**:
What the app records locally when a Kit Sync Job discovers the address it was about to write to is Cancelled. It exists so settings can explain the refusal without calling Kit, and it is a cached observation rather than a verdict: the next Subscribe press re-reads Kit and clears it if the physician has resubscribed in the meantime.
_Avoid_: Blocked, banned, blacklisted — nothing punitive happened; the physician asked

**Resubscribe Form**:
The Kit-hosted form at `https://directcaretools.kit.com/resubscribe` (form id `9934917`, uid `263b30720e`) — the only way a Cancelled subscriber becomes active again, and the only part of the consent flow Launch Tasks does not own. The app links to it and never operates it: `state` is create-only on Kit's API, so there is no write that resurrects anyone. Its double opt-in stays on deliberately, because the confirmation email *is* the explicit permission Kit requires. Verified live: a Cancelled subscriber that completes it returns to `active` with `canceled_at` cleared, keeping both its subscriber id and its Practice State.
_Avoid_: Re-signup form, opt-in form, the Kit form (there are five; this is the only one Launch Tasks links to)

**Kit Sync Job**:
A queued unit of work that writes one fact about one User to Kit. Never runs inside a request, never blocks registration, and always reads Kit's subscription state before it writes.
_Avoid_: Sync, webhook (there are none), Kit integration

**Consent Wording**:
The exact sentence a User agreed to, identified by a version. The wording is versioned and never rewritten in place, so an old version always means what it meant.
_Avoid_: Terms, policy, disclaimer

### Leaving

**Leaving**:
A Member removing themselves from a Practice. Their Membership and their User are both gone, immediately and together, down the same revocation path as being removed by the Owner — there is no account without a Practice, so Leaving *is* deleting for a Member. What they wrote stays: Notes belong to the Practice. An Owner cannot Leave, only delete the Practice, because no co-owners means Leaving would orphan the list.
_Avoid_: Deactivate, quit, close account (there is no account separate from the Practice)

**Grace Period**:
The thirty days between an Owner deleting their Practice and the Purge. The Practice is unreachable to everyone in it — Members are signed out the moment it is deleted — but nothing is destroyed yet, and the Admin can restore it if the Owner asks. Disclosed, never silent: the confirmation says the practice is permanently deleted after thirty days, because telling someone their data is gone while holding it for a month is the one promise here that would be false.
_Avoid_: Trash, soft delete (the mechanism, not the period), cooling-off, retention window

**Purge**:
The irreversible end of the Grace Period: the Practice, its Task Entries, its Custom Tasks, its Memberships, its outstanding Invites, its Feedback (ADR-0007), and the Users of everyone who was in it — the Owner included — all deleted. Nothing is purged before it, and there is no partial Purge. It deliberately does not reach Kit: a Kit subscriber consented to a separate relationship and leaves it through the unsubscribe link in the email, never through deleting a Practice.
_Avoid_: Hard delete (accurate but says nothing about when), wipe, scrub (that word is taken, below)

**Scrub**:
Replacing the Notes and email addresses in a copy of the production database before it is used for development. The daily cold backup is real physician writing on a real laptop, so the scrub script is the default path into it; an unscrubbed copy is for restoring from, or for the rare incident that genuinely cannot be reproduced without the real rows. The handling rule lives in the restore runbook, not in the privacy policy — a policy that enumerates the operator's laptop hygiene is promising something it would then have to keep.
_Avoid_: Anonymize (it is not rigorous enough to claim that word), sanitize, masking

**Subprocessor**:
A third party Launch Tasks hands user data to. Resend and Kit are named in the privacy policy, because a physician who receives email should be able to find out how; the backup providers are described rather than named, since naming them buys nothing and turns a vendor swap into a policy edit.
_Avoid_: Vendor, integration, partner
