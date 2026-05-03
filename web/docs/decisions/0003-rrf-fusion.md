# 0003 — RRF fusion replaces weighted-sum + balanceBySource

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
The previous scoring used a weighted sum of normalised signals: cosine
embedding similarity, BPM proximity, key compatibility, energy, source rank,
embed bonus. Per-source rebalancing was applied as a post-processing step
(`balanceBySource` round-robin) to prevent cosine from dominating.

Two structural problems:

1. The signals are on incompatible scales. Cosine score (0-1 audio similarity),
   tag Jaccard (0-1 set overlap), DJ co-play frequency (raw count) are not
   comparable as numbers. Combining them via fixed weights silently postulates
   they are.

2. Weighted-sum and round-robin actively fight each other. The first ranks
   cosine highly because audioSimilarity weight is 0.42; the second forces
   25%-per-source so non-cosine results jump above cosine's lower-ranked
   results. Top-3 isn't "best 3"; it's "best from each source".

**Decision:**
Replace both with Reciprocal Rank Fusion (Cormack, Clarke, Buettcher 2009):

```
score(track) = Σ_i 1/(k + rank_i(track))
```

Each source produces its own ranked list. Tracks accumulate score by appearing
in multiple sources at decent ranks. k = 60 default.

**Consequences:**
- Positive: rank-based fusion is scale-invariant. We don't need to calibrate
  signal weights against each other.
- Positive: multi-source agreement becomes a first-class signal — a track
  high in cosine + last.fm + trackid outranks one only in cosine.
- Positive: graceful degradation when cosine is silent. With weighted-sum,
  cosine-absent meant the dominant 0.42-weight signal was missing and ranking
  was effectively random. With RRF, fusion proceeds over remaining sources
  unaffected.
- Negative: per-track BPM scoring (Gaussian decay around source BPM) is no
  longer in the fusion. Replaced with hard BPM range filter as user-set
  preference. If eval shows BPM-tight queries regress, hybridise back.
- Negative: cosine's high-confidence top match no longer always wins. If user
  reports show this is wrong (e.g. cosine 0.95 match buried under
  multi-source 0.85 average), consider hybrid: cosine top-1 always promoted.

**Alternatives considered:**
- Keep weighted-sum, recalibrate weights per-source — rejected because the
  scale-incompatibility is structural, not a calibration issue
- CombSUM/CombMNZ — older fusion methods, more sensitive to score
  normalisation, RRF is the modern default
- Learned-to-rank (LTR) — overkill for current scale; needs much larger
  labeled dataset than our 30 seeds. Future work.

**Revisit when:**
- Eval shows a class of queries regressed > 5% nDCG vs the pre-RRF baseline
  and the regression is linked to RRF (not other concurrent changes)
- Result list size grows beyond 50 (RRF k=60 defaults assume short lists)
