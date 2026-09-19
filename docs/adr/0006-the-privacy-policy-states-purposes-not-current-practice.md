---
status: accepted
---

# The privacy policy states purposes, not current practice

Where the privacy policy describes what Launch Tasks does with data, it describes **what the data is used for**, in the present tense, rather than **which features currently exist**. The load-bearing case is measurement: v1 collects no analytics at all, and "learning what stalls people" is ruled out of scope — yet the policy says:

> We look at how practices use the task list — for example, which tasks tend to stall — to improve the guidance we write. We do not sell your data, and we do not share it with advertisers.

The same principle keeps the backup sentence generic ("Backups are encrypted and retained for a limited period, and are accessible only to the operator") instead of describing the scrub rule, the two providers, or the laptop.

## Why

A privacy policy is a promise to people who cannot verify it, which makes it **hard to un-tell** — the same property ADR-0001 identified in the Support View disclosure. A sentence like *"we do not currently collect analytics"* is accurate today and becomes a broken promise the first time a number is wanted. Worse, it makes a **policy revision a prerequisite for ever measuring anything**, and a revision to a document nobody re-reads is a poor gate on a decision that deserves a real one.

Stating the purpose is not a licence to collect anything: the purpose named is narrow and specific ("to improve the guidance we write"), and the two things a physician actually fears — sale and advertising — are refused flatly, in the only sentence in the document that is an absolute.

Scope makes this defensible where it might not be elsewhere. Launch Tasks holds no PHI, takes no payment, and its whole data set is a business checklist.

## Considered and rejected

- **Describe v1 exactly, revise later.** The honest-and-costly option, and a real one: it is strictly accurate on the day it ships. Rejected because the accuracy is temporary and the cost is permanent — every future measurement inherits a documentation chore it will be tempted to skip, and a stale policy is worse than a broad one.
- **Say nothing about measurement.** Rejected as the worst of both: silence reads as "nothing is collected" to the physician while foreclosing nothing legally, which is precisely the quiet capability ADR-0001 refused to allow for Support View.
- **Name every subprocessor, including backup storage.** Rejected for the providers that hold only encrypted blobs; Resend and Kit are named, because a physician receiving email has a real question the policy should answer.

## Consequences

- **The policy permits more than the product does.** That gap is intentional and must stay narrow: it is a licence to measure usage of the task list for content improvement, not a general data licence, and a future feature that exceeds it needs a new sentence rather than a generous reading of this one.
- **Deciding to measure something is no longer gated by a policy edit**, so it needs its own gate. The map already says so: the decision about what is *never* measured comes before the decision about what is, and it belongs with real practices on the list.
- Swapping a backup provider is an operational act, not a legal one.
- The counterpart obligation is unaffected: ADR-0001's disclosure sentence is a statement of a capability that exists today, and it is written in exactly the terms the product means.

Full reasoning and the rest of the legal-surface decisions: [issue #18](https://github.com/jasonmlarsen/dpcstartuptasks/issues/18).
