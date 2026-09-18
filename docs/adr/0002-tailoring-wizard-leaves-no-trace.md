---
status: accepted
---

# The Tailoring Wizard leaves no trace

The **Tailoring Wizard** sets Tasks to **Not Applicable** on a Practice's behalf, and records nothing about having done so. The Task Entries it marks are indistinguishable from ones the Practice marked itself: no provenance column, no "set aside by setup" flag, no way — then or ever — to ask which Tasks the Wizard touched. The Wizard runs once per Practice and never returns, so it is never re-answered and never re-applied to Tasks published later.

## Why

The Wizard runs **once, at the start, on an untouched list**. A Practice's own Not Applicable marks do not exist yet when it fires, so at the moment provenance would be written there is nobody who could ever read it to answer a question they don't already know the answer to. Provenance earns its place when two sources of the same fact are interleaved over time; here they are separated by the whole life of the Practice.

Everything provenance would have bought was bought more cheaply by a rendering decision instead. Because **Not Applicable sinks and dims rather than disappearing**, the Tasks the Wizard set aside are sitting on the list in front of the physician, readable and one click from being changed back. *That* is what makes the Wizard safe to run without a record: the reversal is not a feature the product must provide, it is the Status control that already exists on every Task.

The audience argues for it too. This is a free product for physicians opening their first business, and the failure mode that matters is a list that feels overwhelming — not a list whose bookkeeping is imprecise.

## Considered and rejected

- **A `status_source` column on the Task Entry, plus a stored Practice Profile to diff against.** This was designed in full: a re-answerable Wizard that could only flip Entries it had set itself and that nobody had touched since, reporting how many came back and how many were left alone. Rejected as machinery in service of a case — the mobile practice that signs a lease — that the physician resolves by marking eight Tasks in-place, on a screen they are already looking at.
- **A separate Status, e.g. *Set Aside*, distinct from Not Applicable.** Rejected because it adds a fifth bucket to the list's sort order, a second thing that renders differently, and a second thing to explain, for a distinction the physician does not have. They care that it is off their list; only the product would have cared who put it there.
- **Re-applying the answers to Global Tasks published later.** Rejected because it makes every future Task an editorial problem: the Admin would have to declare, for each one, which Wizard answers retire it — a permanent tax on the Task Library for a handful of rows a year.
- **Letting a skipper re-open the Wizard later.** Rejected on the same grounds as the rest: the questions are trivially replaceable by marking two Phases Not Applicable by hand.

## Consequences

- **The loss is unrecoverable and retroactive.** This is the genuinely irreversible part. Adding provenance later only describes Practices created after the change; for every Practice that already ran the Wizard, which Tasks it set aside is gone and cannot be reconstructed. If "which Tasks does tailoring set aside in practice?" ever becomes a question worth answering, the answer starts from the day the column is added.
- The **Practice Profile** — state, fixed-location, expects-employees — *is* kept, so the Practice's *answers* survive even though their *effects* are untraceable. It is stored for wording and for segmenting email, and nothing in v1 re-reads the two booleans.
- The Wizard's safety now depends on a rendering choice in a different part of the product. **If Not Applicable ever goes back to collapsing out of view, this decision breaks**: the Wizard becomes a thing that silently removed Tasks with no record of what it removed. The two must be changed together or not at all.
- **The Wizard flag lives on the Practice, not the User**, and only the Owner ever sees it. With no provenance there is no undo, so a Member joining an in-flight Practice must never be able to trigger a bulk Not Applicable pass over months of the Owner's work.

Full reasoning and the rest of the onboarding decisions: [issue #6](https://github.com/jasonmlarsen/dpcstartuptasks/issues/6).
