---
status: accepted
---

# Support View: the Admin sees a Practice's full contents, including Notes

The Admin can enter any Practice through **Support View** and see it exactly as its Owner does — Notes included — with nothing redacted, and can act as the Owner would. The glossary previously promised the opposite (`Private Note`: *"never visible to the Admin"*), so that promise was removed rather than left standing: **Private Note is now just `Note`**.

## Why

The deciding argument is about the people this is for, and it came from the owner's own history working with physicians: **they would rather have something fixed quickly than worry about privacy**, particularly for something as ordinary as a business checklist. A support specialist who cannot see the one field a physician is most likely to be confused about cannot actually help them, and this audience — many opening their first business — is the least equipped to debug around a blind spot on the operator's side.

Scope matters to the judgement: this is a task list for *starting a company*. It holds no patient data and is not a clinical system, and physicians understand that distinction better than most users would.

## Considered and rejected

- **Redacting note bodies in Support View.** The argument for it was real: free-text boxes given to physicians will eventually contain a patient detail, and displaying notes routinely in an operator UI turns that accident into something read casually. Rejected because it removes exactly the field support most often needs, in exchange for a boundary the operator could cross with one SQL query anyway.
- **Consent-gated, time-windowed access** (the Owner grants support access for 24h). Rejected as too much machinery for ~50 Practices and a single operator, and it fails precisely when the physician is stuck and unresponsive.
- **Naming the field `Custom Note`.** Rejected on vocabulary grounds: *Custom* is load-bearing against *Global* for Tasks, and there is no Admin-authored note for it to contrast with.

## Consequences

- **The privacy policy must state that the operator can view a Practice's full contents, Notes included.** This is not optional copy — it is the disclosure that makes the decision honest, and it is the one part of this that is genuinely hard to reverse, because it cannot be un-told.
- Support View is **writable**, so a write made while impersonating is indistinguishable from the physician's own. Mitigated by a non-dismissible banner, an unextended 1-hour session, and an `impersonation_log`; not eliminated.
- Deciding this also decided the naming: any future feature promising privacy *within* the product now has no vocabulary to borrow, which is the intended effect.

Full reasoning and the rest of the admin-panel decisions: [issue #5](https://github.com/jasonmlarsen/dpcstartuptasks/issues/5).
