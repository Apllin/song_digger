# 0005 — Camelot key as soft signal, not hard filter

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
Camelot wheel notation expresses harmonic compatibility for DJ mixing —
adjacent keys (8A → 9A, 8A → 8B) blend; distant keys clash. A natural
question: when the user filters by key, should distant-key tracks be excluded
from results?

DJs benefit from harmonic mixing, but stylistic similarity is largely
independent of key. A hypnotic techno track in 8A and one in 2A are both
hypnotic techno; their key difference doesn't reduce stylistic relatedness.
Filtering hard by key would crush the recall of "similar tracks" mode for
the sake of mixing convenience.

**Decision:**
Camelot key only contributes a graduated score bonus, never a filter. Distance
on the wheel decays linearly: exact match = 1.0, max distance (7 = circular
+ ring flip) = 0.0. Tracks at any key distance remain in the result list.

**Consequences:**
- Positive: variety preserved; users discovering similar tracks get the full
  stylistic neighbourhood
- Positive: harmonic-aware DJs can sort by key match within their result
  list (potential future UI feature)
- Negative: a strict harmonic-mixing user gets results they need to filter
  client-side. Acceptable given the discovery-vs-mixing trade-off — this
  app is primarily for discovery.

**Alternatives considered:**
- Hard key filter when user specifies a key — rejected for variety/recall
- No key signal at all — rejected, key is a real if minor stylistic cue
- Configurable strict/soft mode — overengineering; if needed, add later

**Revisit when:**
- A power-user DJ workflow emerges where strict-key is the dominant use case
- The eval set extends to evaluate harmonic mixing quality specifically
