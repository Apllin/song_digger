# 0008 — Tier-based fallback for unknown seeds

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
Cosine.club has the strongest signal but a small catalog (~1.15M tracks).
Many underground or recent tracks are simply absent. When that happens, the
system has historically degraded silently to whatever YTM and Bandcamp could
find — often poorly aligned with the seed.

We need explicit, documented degradation paths AND user-visible honesty
about confidence.

**Decision:**
Four explicit tiers:

| Tier | Trigger | Strategy |
|------|---------|----------|
| 1 (direct) | Seed found in ≥ 3 sources | Standard RRF on all source lists |
| 2 (mediated) | Seed found in 1-2 sources | Use top-K (5) cosine candidates as proxy seeds for silent sources, gather their results, RRF the union |
| 3 (artist) | Artist resolvable but seed unknown | Each source's "similar by artist" path, then RRF |
| 4 (tag-only) | Artist also unresolvable | Cosine text candidates → Last.fm tags → tag-search per top tag, then RRF |

Tiers do not mix into each other's results. UI displays tier label
("direct" / "mediated by similar tracks" / "by artist" / "by tags") and an
explanation.

**Consequences:**
- Positive: most "underground" cases land cleanly in T2 with sensible results
  rather than degrading to noise.
- Positive: user knows the system's confidence level — honest output is more
  useful than seemingly-confident wrong output.
- Positive: T2 mediation is the single biggest behavioural improvement for
  small-catalog cases.
- Negative: T2 doubles API load when triggered (one extra round of queries
  per silent source × top-K candidates).
- Negative: T4 is best-effort; quality varies wildly. UI must de-emphasize
  these results clearly.
- Negative: complexity in the dispatcher. The `similar.py` route grows; needs
  good test coverage per-tier.

**Alternatives considered:**
- No tiers, always run everything — rejected, T4-style fallback wastes API
  calls for the common T1 case.
- Hide tier from user, show results uniformly — rejected; misleading. Honesty
  is a feature.
- More tiers (e.g. genre-only, era-only) — rejected for now; not enough
  signal to differentiate. Add later if a clear T5 case emerges.

**Revisit when:**
- T2 mediation API cost becomes noticeable (need to add cache or budget)
- Eval shows T4 results are net-zero useful (in which case, just refuse to
  serve them and tell the user "couldn't find similar tracks")
