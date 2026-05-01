# Scoring Architecture

## Goal

Rank candidate tracks by audio + stylistic similarity to a seed track,
combining signals from multiple heterogeneous sources (Cosine.club embeddings,
YouTube Music radio, Bandcamp recommendations, Last.fm tags, 1001tracklists
co-play, trackid.net co-play, label graph). Optimised for hypnotic /
industrial / dub techno discovery.

This document describes the **current** scoring approach. It is updated as
part of any PR that changes scoring. ADRs in `docs/decisions/` capture why
specific decisions were made.

## Signal hierarchy (in order of trust)

1. **Audio embedding similarity** (cosine.club) — the only signal that
   actually "listens" to the track. When confident and present, dominates;
   when absent, gracefully steps aside (RRF handles this by construction).
2. **Multi-source agreement** (RRF across all sources) — a candidate
   appearing high in N independent sources is stronger evidence than any
   single high score from one source.
3. **DJ co-occurrence** (1001tracklists, trackid.net) — proxies "selectors
   hear these as compatible". DJs select by ear, not by tag, so this captures
   stylistic adjacency that no metadata source does. Strong for established
   artists, weak for underground.
4. **Tag overlap** (Last.fm) — community semantic agreement. Noisy but covers
   long-tail artists where (1) and (3) are silent.
5. **Label proximity** (label graph) — same/sister label = strong stylistic
   prior in techno specifically. Useful when audio signal is missing or
   silent. See `decisions/0010-label-graph.md`.
6. **BPM proximity** — necessary but not sufficient. Same-BPM tracks span
   wildly different subgenres. With tempo doubling support (70 ↔ 140) for
   harmonic subdivision compatibility.
7. **Camelot key compatibility** — soft signal, never a hard filter. Wide
   spread inside any subgenre. See `decisions/0005-key-as-soft-signal.md`.
8. **Source rank** — last-resort proxy when nothing else is available. Mostly
   subsumed by RRF after instruction 08.

## Hard floors (auto-reject regardless of score)

- Disliked artist (user feedback in current session) — small score penalty,
  not a filter, but in the limit it suppresses
- BPM outside user-set range (when range is set)
- Source artist match when `filterSourceArtist` is true (the seed's own
  artist is filtered out by default; see `decisions/0002-source-artist-filter.md`)

NOT a floor: low Camelot match — variety > harmonic strictness.

## Fusion strategy: RRF

Each source produces a ranked list of candidates. Final score per track is
`Σ_i 1/(k + rank_i(track))` summed over sources where the track appears, with
k = 60 (Cormack 2009 default). Tracks not in any source list naturally score 0.

Why RRF and not weighted-sum: scores from different sources are not on
comparable scales (cosine similarity ≠ tag Jaccard ≠ co-play frequency).
Ranks are comparable by construction. Multi-source agreement emerges
naturally rather than being engineered. See `decisions/0003-rrf-fusion.md`.

## Post-RRF adjustments

After RRF, the following modifications apply (in this order):

1. **BPM hard filter** (drop if outside user range)
2. **Disliked-artist penalty** (-0.012 from final RRF score; calibrated to
   demote ~3 ranks but not bury good matches)
3. **Embed bonus** (+0.0008; ties broken in favour of inline-playable)
4. **Liked-centroid blend** on BPM/key references used by any post-RRF
   adjustments that look at metadata match
5. **Genre exact-match bonus** (+0.001 when track.genre == source_genre)
6. **Label graph proximity bonus** (+0.001 × graph_similarity, capped at 0.001)
7. **Artist diversification** (existing `diversifyArtists`): max 2 consecutive
   tracks by same artist, regardless of score

## Tier-based fallback (when source unknown to some sources)

| Tier | Trigger | Strategy |
|------|---------|----------|
| 1 (direct) | Seed found on ≥ 3 sources | Standard RRF on all |
| 2 (mediated) | Seed on 1-2 sources | Use top-K cosine results as proxy seeds for silent sources, then RRF |
| 3 (artist) | Seed unknown but artist resolved | Artist-similarity queries on each source, then RRF |
| 4 (tag-only) | Artist unknown | Cosine candidates → Last.fm tags → tag-search, then RRF |

Higher tiers do not mix into lower tiers' results. UI shows tier explicitly.
Confidence to user is honest, not faked. See `decisions/0008-tier-based-fallback.md`.

## Calibration

All weights and thresholds are *current values*, not *correct values*. They
are baselines for the eval harness. Any change requires running
`pnpm eval --baseline eval/runs/baseline.json` and attaching the metric diff
to the PR.

| Constant | Current | Source of truth |
|----------|---------|-----------------|
| RRF k | 60 | Cormack 2009 default; verified on eval set v1 |
| Cosine confidence threshold | 0.5 | `decisions/0001-cosine-confidence-threshold.md` |
| BPM gauss sigma | 12 | Tuned on eval set v1 |
| Disliked penalty | 0.012 (post-RRF) | Calibrated to demote ~3 ranks |
| Liked weight per track | 0.12 | Caps at 0.65 (≈ 5+ liked tracks) |
| Tier 2 mediation top-K | 5 | Empirical; revisit per `decisions/0008` |
| Last.fm rate semaphore | 5 | Public API recommendation |
| 1001TL set-page limit | 20 | Per-query budget; cache amortizes |

## Known limitations

- Cosine.club is the only embedding source — single point of failure for the
  strongest signal (RRF mitigates: when it's silent, others carry the load)
- Beatport BPM/key sometimes disagree with cosine (label-reported vs
  audio-derived); cosine wins, beatport fills gaps only — see `decisions/0007`
- Tempo doubling (70 ↔ 140) is on; correct for most techno, occasional
  false positives on ambient/idm seeds
- Russian/cyrillic artists undertested on Last.fm signal (eval coverage
  intentionally includes a few to track this)
- Label graph requires periodic rebuild; stale graph degrades signal quality
  silently. Add monitoring per `decisions/0010-label-graph.md`.

## Failure modes the harness catches

- Ranking by tempo alone (false friends with same BPM, different style)
- Cosine-only collapse when other sources are silent (the big T2 case)
- Round-robin diversity overpowering audio signal (the bug RRF fixed)
- Remix vs original conflation in dedup (the normalize_title bug)
- Subgenre boundary leakage (peak-time techno bleeding into hypnotic queries)

## Out-of-scope

- Personalised long-term recommendations (user history, listening patterns).
  We optimise for the single-seed similar-tracks query.
- Recommendation diversity *across* the result set beyond the existing artist
  diversification.
- Multi-seed queries (give me tracks similar to BOTH X and Y). Possible
  future extension via centroid in cosine embedding space.
