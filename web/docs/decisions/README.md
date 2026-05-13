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
| 0004 | Tempo doubling treated as near-match | Superseded by ADR-0003 |
| 0005 | Camelot key as soft signal, not hard filter | Deferred / superseded by ADR-0016 |
| 0006 | Bandcamp 4-second timeout | Superseded by ADR-0023 |
| 0007 | Beatport cache strategy | Superseded by ADR-0015 |
| 0008 | Tier-based fallback for unknown seeds | Superseded by Stage B+ |
| 0009 | Eval harness as merge gate | Accepted |
| 0010 | Label graph similarity | Deferred |
| 0011 | Feature vector schema for learned ranking | Superseded by ADR-0019 |
| 0012 | Remove 1001tracklists adapter | Accepted |
| 0013 | Discogs feature caches for Stage C2 | Superseded by ADR-0019 |
| 0014 | Trackid.net rewrite as JSON API client | Accepted |
| 0015 | Remove Beatport adapter | Accepted |
| 0016 | Drop BPM/key from ranking | Accepted |
| 0017 | Track-level dislike filter via identity match | Accepted |
| 0018 | Test coverage strategy (unit / smoke / speed) | Accepted |
| 0019 | Remove feature extraction infrastructure | Accepted |
| 0020 | Authentication (Stage I) | Accepted |
| 0021 | Anonymous limits and security (Stage J) | Accepted |
| 0022 | Trust adapter similarity (Last.fm artist path) | Accepted |
| 0023 | Remove Bandcamp adapter | Accepted |
| 0024 | Cosine contributes nothing when it lacks the queried track | Accepted |
