# 0004 — Tempo doubling treated as near-match

**Date:** 2025-01-XX
**Status:** Superseded by ADR-0003 (2026-05-03 — `calculateBpmScore` was removed alongside the weighted-sum scorer; BPM is now a hard filter only, see scoring.md §"Hard filters").

**Context:**
DJs and producers regularly pitch-shift tracks between harmonic subdivisions
of the same groove. A 70-BPM downtempo track can be played at 140 BPM (double
time) with the same beat structure intact. Beatport, BPM-detection software,
and DJ tools commonly report a track at half- or double-time relative to its
"natural" feel — there's no single correct value for many tracks.

Treating 70 vs 140 BPM as "very different" produces false negatives: a
broken-beat 70 BPM track and a 140 BPM techno cut may share rhythmic DNA and
sit comfortably side-by-side in a set.

**Decision:**
In `calculateBpmScore`, the delta is computed as the minimum of:
- `|trackBpm - refBpm|`
- `|trackBpm - refBpm * 2|`
- `|trackBpm - refBpm / 2|`

This makes 70 BPM ↔ 140 BPM a near-zero delta (high score).

**Consequences:**
- Positive: catches genuinely compatible tracks across tempo subdivisions
- Positive: matches DJ intuition for techno/house specifically
- Negative: occasional false positives. A 70-BPM ambient track will score
  high against a 140-BPM peak-time techno seed by tempo alone; other signals
  (audio embedding, label) need to catch the mismatch. Mostly fine in
  practice because audio similarity dominates anyway.

**Alternatives considered:**
- Strict BPM match — rejected, misses real DJ-compatible pairs
- Single-direction (only `/2`, never `×2`) — rejected, asymmetric and would
  miss "track is half-time at 70 vs ref at 140" case

**Revisit when:**
- Eval shows ambient/IDM seeds frequently get peak-time techno results
  scored highly by tempo alone
- Adding a non-techno genre where tempo-doubling is uncommon (most house
  music, drum'n'bass at fixed 174 BPM)
