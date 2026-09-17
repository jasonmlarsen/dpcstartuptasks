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
The operator of the whole product, who edits the Task Library for every Practice. Not a role within a Practice.
_Avoid_: Superuser, staff

**Membership**:
The link between a User and the one Practice they belong to, carrying their role of Owner or Member. A User belongs to exactly one Practice.
_Avoid_: Seat, role assignment, affiliation

**Invite**:
An Owner's outstanding offer of a Membership to an email address. Counts against the Practice's three-person cap while it is pending, so acceptance can never breach the cap.
_Avoid_: Invitation link, request, pending user

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
_Avoid_: Notes (that word means the Practice's private writing), description, details

**Helpful Link**:
A curated, labelled link on a Global Task. The label is always present and is what a physician reads; a bare URL is a bug.
_Avoid_: Resource, reference, URL

**Dependency**:
A statement that one Task usually comes after another. Advice, never enforcement — nothing in the product is ever locked.
_Avoid_: Prerequisite, blocker, gate

### A Practice's own work

**Status**:
Where a Practice has got to on one Task: not started, in progress, done, or not applicable.

**Not Applicable**:
A Status meaning this Task will never apply to this Practice. Collapses out of the main view and stops counting against progress — the state that makes the list feel achievable rather than accusatory.
_Avoid_: N/A as a stored value, skipped, dismissed, hidden

**Private Note**:
A Practice's own writing on a Task. Never visible to the Admin or to other Practices, and never authored in raw HTML.
_Avoid_: Comment, annotation

**Task Entry**:
A Practice's row for one Task, carrying its Status, Private Note and target date. Exists for every Task from the moment a Practice is created, not only once the Practice has touched it — so "no Entry" never means anything.
_Avoid_: Override (it is not only present when something changed), progress record, task instance

**Override**:
The *concept* of the Practice-owned layer sitting on top of the Admin-owned Task Library. The thing that holds it is a Task Entry. A Practice may never rename or rewrite a Global Task's Body.
_Avoid_: using this word for the row itself — that is a Task Entry

**Newly Added**:
A Global Task published after a Practice already existed, flagged to that Practice until someone there opens it. Tasks present when the Practice was created are never Newly Added.
_Avoid_: Unread, unseen, updated

**Retired**:
A Global Task the Admin has withdrawn from the Task Library. Never deleted, because Practices have Task Entries against it and may already have done the work.
_Avoid_: Deleted, archived, disabled

### Consent

**Email Consent**:
A User's permission to be sent occasional non-transactional email. Asked once, at registration, as a checkbox that is ticked by default and never a condition of using the product — Launch Tasks is free and stays usable whether or not it is given.
_Avoid_: Subscription (that is Kit's word for its own state), opt-in, marketing permission

**Consent Wording**:
The exact sentence a User agreed to, identified by a version. The wording is versioned and never rewritten in place, so an old version always means what it meant.
_Avoid_: Terms, policy, disclaimer
