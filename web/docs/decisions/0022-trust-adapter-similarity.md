# 0022 — Trust adapter similarity, remove eval harness and score floors

**Date:** 2026-05-07
**Status:** Accepted

**Context:**
ADR-0009 made the eval harness (`python-service/eval/`, nDCG@10 over a
30-seed golden set) a merge gate for any change touching scoring, fusion,
or adapter logic that affects ranking. The harness was the discipline
behind several earlier ranking ADRs: 0001 (cosine confidence threshold),
0003 (RRF fusion), 0004/0005 (tempo-doubling, soft key signals), 0008
(tier-based fallback), 0016 (drop BPM/key from ranking).

Stages F–H (ADR-0015, 0016, 0019) progressively narrowed the project's
ranking philosophy to *trust the adapter's own similarity ordering and
combine across sources via RRF*. After Stage H the only on-our-side
manipulations of adapter output were:

1. **RRF fusion + multi-source rank bonus.** A track returned by N
   sources lands higher than a track returned by one. This is the
   policy.
2. **Artist diversification** (max 2 consecutive same-artist tracks in
   `web/lib/aggregator.ts`). UX guard against same-artist clusters at
   the head of the list.
3. **Last.fm `MIN_MATCH = 0.05` floor** (ADR-0009-era heuristic
   introduced in commit 8900fee with no eval data behind it — "below
   this similars become unrelated"). A score-based filter on adapter
   output.
4. **Last.fm `lastfm_artist_fallback_enabled` flag.** Default-on
   gate around the artist-level fallback path
   (`artist.getSimilar` → `artist.getTopTracks`), kept as a kill-switch
   "until eval confirms it doesn't bleed genres."

Items 3 and 4 are the kind of artificial filtering the trust-the-adapter
direction explicitly rejects: we are second-guessing Last.fm's own
ordering without a measurement that justifies the floor, and gating a
clearly-useful expansion path behind a flag whose only reason for
existing was eval calibration. With ranking decisions no longer being
tuned, the eval harness itself has no consumer either — it exists to
prevent "subjectively better" syndrome, but the policy now is to *not*
tune subjective ranking choices and to defer to the source's own
similarity output instead.

**Decision:**
Remove the eval harness in full and remove the two Last.fm-side
artificial filters. Specifically:

- **Eval harness — full removal.** Delete:
  - `python-service/eval/` (`runner.py`, `metrics.py`, `golden-set.json`,
    `runs/`, `README.md`)
  - `python-service/tests/test_eval_metrics.py`
  - `"eval"` script entry in root `package.json`
  - `"eval"` script entry in `python-service/package.json`
  - `eval/runs` line from `python-service/.dockerignore`

- **Last.fm `MIN_MATCH` floor — removed.** The constant and the
  `if match < MIN_MATCH: continue` filter in
  `_fetch_track_similar` are deleted. We now return every result
  Last.fm chose to include in `track.getSimilar`, in its order.

- **Last.fm artist-fallback flag — removed.** The
  `lastfm_artist_fallback_enabled` setting in `app/config.py` and
  every read site in `app/adapters/lastfm.py` are deleted. The
  artist-level path is now unconditional and runs in two cases:
  (a) `track.getSimilar` returned empty for an Artist–Track query, and
  (b) the query is artist-only with no track component, in which case
  the adapter goes straight to the artist path (previously returned
  `[]`).

- **Artist diversification stays.** It is a UX guard, not a quality
  filter on adapter output, and the trust-the-adapter direction does
  not apply to presentation choices.

- **RRF + multi-source rank bonus stays.** Codified by ADR-0003. The
  multi-source bonus is the single explicit policy ("a track returned
  by N sources outranks a track returned by one").

- **ADR-0009 marked Superseded** by this ADR; the harness it gated is
  gone.

**Consequences:**

- The pipeline through `web/lib/aggregator.ts` is now the *only*
  manipulation of adapter output: RRF fuses ranks, artist
  diversification reorders for presentation, and that's it.
- Last.fm artist-only queries (`"Oscar Mulero"` with no track) now
  produce results instead of returning `[]`. The artist-level path
  reuses the existing `_artist_fallback` (top-N similar artists ×
  3 tracks each, capped at 30, scored by `match × position_decay`).
- Last.fm low-match tracks (`match < 0.05`) now reach the fuser. They
  land low in Last.fm's own ordering, so RRF gives them small
  contributions; the multi-source bonus continues to surface tracks
  that multiple sources agree on regardless of any single source's
  match score. There is no measurable downside; the floor never had
  evidence behind it.
- Future ranking changes do not need an eval diff in the PR. Reviewers
  are no longer entitled to ask "what's the nDCG impact?"; the answer
  is "we trust the adapter, see ADR-0022."
- The `extend-eval-set` skill (if installed in the user's global skill
  set) and the `eval-gated-changes` skill no longer have any
  in-repo target. They are out-of-tree user skills, so this ADR
  doesn't delete them, but they are obsolete from the project's
  perspective.
- ~600 lines of Python deleted (runner + metrics + golden set + 23
  baseline run files). One unit test file deleted.

**Alternatives considered:**

- **Keep the eval harness "in case we change our minds."** Rejected.
  The harness costs maintenance (the golden set rots, requirements
  drift) and its presence implies it's a gate. Either it's a gate or
  it isn't; "optional eval" was already rejected in ADR-0009 itself.
- **Lower `MIN_MATCH` to a smaller floor (e.g. 0.01) instead of
  removing it.** Rejected. There is no principled value for this
  floor; the original 0.05 was a guess. The trust-the-adapter
  direction says we should not be picking thresholds at all.
- **Keep the `lastfm_artist_fallback_enabled` flag as a kill-switch.**
  Rejected. The flag's documented purpose was "default off until eval
  confirms," then it flipped to default-on once the fallback proved
  useful in practice. With eval gone, the flag has no decision
  procedure attached. Operators can disable a misbehaving fallback by
  unsetting `LASTFM_API_KEY` (the adapter already no-ops without it).
- **Phase the eval removal over multiple commits.** Rejected. The
  removal touches one cluster of files (`eval/`, two `package.json`
  scripts, one dockerignore line, ADR-0009 status); a single atomic
  change keeps the diff legible.

**Supersedes:** ADR-0009 (Eval harness as merge gate for scoring changes).
