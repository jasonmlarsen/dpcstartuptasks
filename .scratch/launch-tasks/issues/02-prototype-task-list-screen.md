# Prototype: the task list screen, and the visual language

Type: prototype
Status: open
Blocked by: 01
Map: ../map.md

## Question

This is the product. A physician opens the app and sees ~100 tasks representing the hardest project of their professional life. The stated goal is that they come away thinking *this is very doable*. The prototype has to earn that.

Answer, by making something concrete and reacting to it:

1. **How is the list made non-overwhelming?** Phases exist specifically to give structure and prevent overwhelm. Is the default view one phase at a time, a "what can I do right now?" shortlist derived from the dependency graph, or something else? What does a physician see in the first five seconds?
2. **How does dependency advice surface without feeling like a lock?** Nothing is ever enforced. "Usually comes after: Obtain EIN" has to read as help, not as a gate.
3. **What does progress look like?** A percentage across 106 tasks may read as discouraging for months. N/A tasks must not count against it.
4. **Mobile and desktop.** Both first-class. A physician checking something off from a parking lot is a real use case.
5. **The visual language.** Translate `styles/design-tokens.css` into the Tailwind 4 theme and establish the core components — task row, phase header, status control, task detail. Visual continuity with `directcaretools.com` matters.

Prototypes are throwaway and exist to be reacted to. Build enough to feel wrong, not enough to keep.

## Notes for the session

Read `styles/design-tokens.css` and resolved ticket 01 first. Call the `prototype` skill. Link the prototype as an asset; do not paste it into this file.
