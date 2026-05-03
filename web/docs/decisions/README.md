# Architecture Decision Records

Lightweight ADRs (Michael Nygard format). Each file documents one decision,
the context, the alternatives considered, and the consequences.

## When to add a new ADR

- Introducing a new external source / adapter
- Changing fusion strategy or weight calibration in a non-trivial way
- Picking between two architecturally different paths (e.g. Postgres-queue
  vs in-process for background jobs)
- Documenting a deliberate choice to NOT do something (e.g. why we don't
  use Spotify)
- Anything where in 6 months a reviewer might ask "wait, why did we do this?"

## When NOT to add an ADR

- Pure refactor with no behavioural change
- Bug fixes
- Routine dependency upgrades
- Tweaking a constant where the rationale is captured in scoring.md's
  calibration table

## Format

Filename: `NNNN-short-slug.md`. Numbers are sequential, never reused.

Body:

```
# NNNN — <Decision>

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by NNNN

**Context:** What problem did we have, what constraints?

**Decision:** What did we choose to do?

**Consequences:**
- Positive consequence
- Negative consequence
- Trade-offs

**Alternatives considered:**
- Alternative A — why rejected
- Alternative B — why rejected

**Revisit when:** What signal would tell us to reopen this decision?
```

## Index

| # | Decision | Status |
|---|----------|--------|
| 0001 | Cosine confidence threshold | Accepted |
| 0002 | Source artist filter on by default | Accepted |
| 0003 | RRF fusion replaces weighted-sum + balanceBySource | Accepted |
| 0004 | Tempo doubling treated as near-match | Accepted |
| 0005 | Camelot key as soft signal, not hard filter | Accepted |
| 0006 | Bandcamp 4-second timeout | Accepted |
| 0007 | Beatport cache strategy | Accepted |
| 0008 | Tier-based fallback for unknown seeds | Accepted |
| 0009 | Eval harness as merge gate | Accepted |
| 0010 | Label graph similarity | Accepted |
| 0011 | Feature vector schema for learned ranking | Accepted |
| 0012 | Remove 1001tracklists adapter | Accepted |
