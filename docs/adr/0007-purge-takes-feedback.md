---
status: accepted
---

# Purge takes Feedback

When a Practice is purged at the end of its Grace Period, the Feedback written by everyone in it is **deleted with it**. Nothing about a Feedback survives the Purge: not the text, not the page it was sent from, not the Task it named.

The alternative, seriously considered, was to **sever** rather than destroy — null `user_id` and `practice_id` and keep the text, `page_path`, `task_title` and `created_at`, on the grounds that a Feedback is a statement about the Admin-owned Task Library and only incidentally about the practice that sent it.

## Why

ADR-0006's principle applies in reverse here: the cheap-sounding option is the one that makes a promise the product cannot keep.

**A severed row is de-identified only in the schema.** Feedback is free text written by a physician about their own practice. "We could not do this in Idaho without an office" identifies its author about as well as a foreign key does. Dropping the FKs would let the product describe those rows as anonymous while they remained readable, which is exactly the quiet capability ADR-0001 refused to allow for Support View.

**It would put a hole in a rule stated cleanly.** [#18](https://github.com/jasonmlarsen/dpcstartuptasks/issues/18) settled that Purge is all-or-nothing and takes the Users too — *"there is no partial Purge."* A surviving category of row makes that sentence need a footnote, in the privacy policy and in every future conversation about deletion.

**The signal it appears to protect is already protected elsewhere.** The value of a Feedback is the Body edit it causes, and a Body edit lives in the Task Library, which no Purge reaches. What is lost is only unread Feedback from a practice that deleted itself — and the Grace Period is thirty days while the digest is daily, so unread-for-a-month is a process failure, not a retention problem.

## Considered and rejected

- **Sever and keep.** Rejected above: it claims an anonymity that free text defeats, and it costs the one-sentence deletion rule.
- **Keep Feedback whole, and treat it as Admin-owned data outside the Practice.** Defensible on paper — the Admin is the recipient, and a recipient keeps their mail. Rejected because the physician was never told they were writing to a permanent record; they pressed Send on a text box in an app that promises deletion.
- **Ask the Owner at deletion time whether their Feedback may be kept.** Rejected as a consent dialog on the most stressful screen in the product, buying an edge case.

## Consequences

- **Purge stays one sentence**, in the policy and in the confirmation dialog. No category of survivor has to be explained.
- **The daily Feedback digest is load-bearing, not a convenience.** It is the mechanism that makes destruction-on-purge acceptable, because it is what makes the thirty-day window real. Removing it later would quietly change this decision.
- **Feedback is otherwise kept forever** — there is no expiry and no delete button. Purge is the only thing that destroys a Feedback, which is what makes this rule easy to state.
- A Feedback whose Task was a **Custom Task** carries no FK at all (Custom Tasks are hard-deleted), so it was already only a `task_title` snapshot; the Purge takes that too.

Full reasoning and the rest of the Feedback inbox: [issue #22](https://github.com/jasonmlarsen/dpcstartuptasks/issues/22).
