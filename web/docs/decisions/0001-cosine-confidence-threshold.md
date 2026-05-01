# 0001 — Cosine.club confidence threshold = 0.5

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
Cosine.club returns a similarity score per result. Below some threshold, the
"similar" tracks are essentially text-matched garbage rather than embedding
neighbours. We need a cutoff to switch into fallback mode (reversed query,
artist-only seeding, beatport BPM enrichment) and to drop low-confidence
results before they pollute the candidate pool.

**Decision:**
Use mean score of top-5 results ≥ 0.5 as "confident". Below that, treat
cosine as not knowing the track and trigger Phase 2 fallbacks. Individual
results below 0.5 are also dropped from cosine's contribution.

**Consequences:**
- Positive: avoids returning low-quality cosine matches as primary results
- Positive: triggers richer fallback paths that catch underground tracks
- Negative: Phase 2 doubles the API load when triggered
- Negative: 0.5 is empirical and may not generalise to non-techno seeds

**Alternatives considered:**
- Per-track filter only (drop only individual items below threshold) — rejected
  because it doesn't trigger fallbacks for genuinely-unknown seeds
- Score-based weight scaling — rejected because cosine score and other signals
  aren't on comparable scales (this is what RRF later solved properly)

**Revisit when:**
Eval set extended beyond techno; current threshold may be too tight or too
loose for other genres. Consider per-genre thresholds if calibration on the
eval set shows large variance.
