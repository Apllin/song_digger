# 0006 — Bandcamp adapter 4-second timeout

**Date:** 2025-01-XX
**Status:** Superseded by ADR-0023 (Bandcamp adapter removed)

**Context:**
Bandcamp's `_get_recommendations` historically required up to 7 sequential
HTTP fetches per query (one for the seed page, then one per "you may also
like" item to extract its numeric tralbum_id). On slow Bandcamp responses
this could push total search latency above 10 seconds — unacceptable for an
interactive search.

After instruction 05's fix, the page-fetches per item are eliminated when
the rec JSON includes `tralbum_id`. But the seed-page fetch remains, and
Bandcamp can still be slow.

**Decision:**
Wrap the Bandcamp adapter's `find_similar` call with a 4-second timeout
(`asyncio.wait_for`). On timeout, return `[]` and log. Other sources
proceed unaffected.

**Consequences:**
- Positive: predictable latency ceiling. The user never waits >5 seconds for
  results regardless of Bandcamp health.
- Positive: degrades cleanly. RRF handles a missing source list correctly
  by construction (no Bandcamp contribution = others carry the load).
- Negative: occasional false skip on legitimate-but-slow Bandcamp responses.
  Acceptable in interactive search; the user can re-run the query.

**Alternatives considered:**
- Longer timeout (10s) — rejected, breaks UX
- No timeout, retry — rejected, makes the cold-cache case much worse
- Background-only Bandcamp (results show on next search) — rejected for now;
  Bandcamp's contribution is stylistically valuable, especially for
  underground releases. Reconsider if instruction 05's fixes don't bring
  median latency under ~1s.

**Revisit when:**
- Median Bandcamp latency consistently exceeds 3s in production logs (timeout
  is firing routinely)
- A user reports "Bandcamp results never appear" — could indicate timeout
  too tight on their location/connection
