# AGENTS.md

Conventions for AI agents working in this repo.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jasonmlarsen/dpcstartuptasks`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels, used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Testing

Four seams, and no fifth: the request seam, the injected outbound clients, the worker, the Seed Script. The request seam is the default and everything else is justified against it. See `docs/agents/testing.md`.
