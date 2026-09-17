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

**Override**:
The per-Practice layer on top of a Global Task: Status, Private Note, target date, ordering. A Practice may never rename or rewrite a Global Task's Body.
_Avoid_: Customization, edit, fork
