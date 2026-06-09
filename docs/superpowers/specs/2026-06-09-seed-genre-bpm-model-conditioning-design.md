# Design: Seed Genre & BPM Model Conditioning

**Date:** 2026-06-09
**Status:** Approved

## Problem

The ML scoring model (logistic regression) has no awareness of the seed track's genre or BPM. It learns one universal set of weights applied to every search — regardless of whether the seed is Techno or Hip-Hop. This means it cannot learn that certain sources or features are more predictive for specific genres or BPM ranges.

## Goal

Add the seed track's genre and BPM as conditioning inputs to the model so it can learn genre-specific and BPM-specific source preferences — e.g. "for Techno seeds, Beatport's rank is a stronger signal than YouTube Music's."

## Approach: Interaction Features (Approach B)

Add seed genre and BPM as one-hot bucket features, plus cross-product interaction terms between those buckets and the existing per-source rank scores. The existing `LogisticRegression(C=0.1)` model does not change — the feature vector is simply wider. L2 regularization keeps sparse-bucket weights near zero and prevents overfitting.

## Data Sources

- **Genre**: Beatport API response already contains `[{"genre_name": "Techno"}]` — the adapter currently ignores it. Parse the first genre name and populate `TrackMeta.genre`. No new API calls or schema migrations required (`genre` already exists on `TrackMeta` and the Prisma `Track` model).
- **BPM**: Already extracted from Beatport. No changes needed for sourcing.
- **Scope**: Seed track only. Candidate tracks are not genre/BPM enriched for this feature.
- **Null handling**: If the seed has no Beatport enrichment at feedback or scoring time, `seedGenre` and `seedBpm` are null. These fall into the `other` genre bucket and `seedBpmPresent=0` BPM state respectively — valid model inputs.

## Feature Engineering

### Genre Buckets (7, one-hot)

Maps Beatport's ~30+ genre names to broad buckets to ensure enough training samples per bucket:

| Bucket | Beatport genre names |
|---|---|
| `techno` | Techno, Hard Techno, Industrial, EBM |
| `house` | House, Tech House, Deep House, Afro House, Melodic House & Techno, Progressive House |
| `drum_bass` | Drum & Bass, Jungle |
| `trance` | Trance, Psy-Trance, Progressive Trance |
| `breaks` | Breaks, Breakbeat, UK Garage |
| `ambient` | Ambient, Downtempo, Chillout |
| `other` | Everything else, or genre unknown |

### BPM Range Buckets (4 one-hot + 1 present flag)

| Feature | Condition |
|---|---|
| `seedBpm_slow` | seed BPM < 90 |
| `seedBpm_mid` | 90 ≤ seed BPM < 120 |
| `seedBpm_fast` | 120 ≤ seed BPM < 140 |
| `seedBpm_vfast` | seed BPM ≥ 140 |
| `seedBpmPresent` | 1 if seed BPM is known, 0 otherwise |

### Interaction Features

Cross-products that let the model learn source preferences per genre and BPM range:

- **Genre × source rank scores**: `genre_bucket_i × source_j_rank_score` for each of 7 genre buckets × 7 sources = 49 features
- **Genre × cosine score**: `genre_bucket_i × cosineScore` = 7 features
- **BPM range × BPM delta features**: `bpmRange_j × bpmDeltaNorm` and `bpmRange_j × bpmCompatible` = 8 features

**Total new features: ~76. Feature vector grows from 14 → ~90.**

## Training Pipeline Changes

### `SampleFeatures` (python-service)
Add two new optional fields:
```python
seedGenre: str | None = None   # raw Beatport genre string, bucketed inside feature builder
seedBpm: float | None = None
```

### `_build_feature_vector` (python-service `train.py`)
Extend to:
1. Map `seedGenre` → genre bucket index → 7-element one-hot
2. Map `seedBpm` → BPM range index → 4-element one-hot + present flag
3. Compute interaction terms: genre one-hot × each source rank score; genre one-hot × cosineScore; BPM range one-hot × bpmDeltaNorm and bpmCompatible

The bucketing logic lives in a shared helper so it is used identically during training and scoring.

### `TrainingResult` (python-service)
Add `genre_weights: dict[str, float]` and `bpm_range_weights: dict[str, float]` to store recovered unscaled coefficients per bucket — surfaced in the admin stats dashboard for interpretability.

## Scoring Changes (Web Aggregator)

`web/lib/aggregator.ts` changes:

1. **At search time**: read `seed.genre` and `seed.bpm` from the enriched seed `Track` record (already on the Prisma model) and thread them into the aggregator context.
2. **When building training samples** (on user feedback): include `seedGenre` and `seedBpm` in the `SampleFeatures` payload sent to `/train`.
3. **At real-time scoring time**: pass seed genre and BPM when constructing the per-candidate feature vector so interaction terms are computed identically to training.

No new API endpoints. No schema migrations.

## What Does Not Change

- `LogisticRegression(C=0.1)` model — same algorithm, same regularization
- Candidate track enrichment — candidates are not genre/BPM enriched
- Beatport BPM extraction — already works
- `TrackMeta.genre` and `Track.genre` schema fields — already exist

## Out of Scope

- Enriching candidate tracks with genre/BPM (separate future feature)
- Genre-aware diversification in result ordering
- Using Last.fm or other sources for genre/BPM
