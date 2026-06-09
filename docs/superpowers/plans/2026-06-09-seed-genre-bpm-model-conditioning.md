# Seed Genre & BPM Model Conditioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the seed track's genre and BPM as conditioning inputs to the ML scoring model so it can learn genre-specific and BPM-specific source preferences.

**Architecture:** Extend the existing 14-feature logistic regression vector to ~90 features by adding genre bucket one-hots, BPM range one-hots, and cross-product interaction terms (genre × per-source rank, genre × cosine, BPM range × BPM delta/compatible). Genre comes from Beatport's genre field (currently unparsed). At scoring time the web aggregator applies the learned interaction weights as per-candidate bonuses, conditioned on the seed's stored genre bucket and BPM.

**Tech Stack:** Python/FastAPI/scikit-learn (python-service), Next.js 16/Prisma 7/TypeScript (web), pnpm/Turborepo (monorepo).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `python-service/app/adapters/beatport.py` | Parse genre from Beatport response |
| Create | `python-service/app/core/genre_buckets.py` | Genre bucket map + one-hot helpers (shared by train + future scoring) |
| Modify | `python-service/app/core/models.py` | Add `seedGenre`, `seedBpm` to `SampleFeatures`; add interaction weight fields to `TrainingResult` |
| Modify | `python-service/app/api/routes/train.py` | Extend `_build_feature_vector` with genre/BPM features and interactions; extract and return interaction weights |
| Modify | `python-service/tests/test_beatport.py` | Test genre parsing |
| Create | `python-service/tests/test_genre_buckets.py` | Test bucketing and one-hot helpers |
| Modify | `python-service/tests/test_train.py` | Update `_sample` helper; add genre/BPM conditioning tests |
| Run | `pnpm codegen` (repo root) | Sync generated TypeScript types from updated OpenAPI spec |
| Modify | `web/prisma/schema.prisma` | Add `seedGenre String?` to `SearchQuery`; add `genreAdjustments Json?` and `bpmRangeAdjustments Json?` to `ModelWeights` |
| Create | `web/lib/genreBuckets.ts` | TypeScript mirror of the Python genre bucket map (must stay in sync) |
| Modify | `web/features/enrichment/server/enqueueBackgroundEnrich.ts` | Persist `seedGenre` bucket after Beatport seed enrichment |
| Modify | `web/lib/aggregator.ts` | Add `seedGenre` to `AudioFeatures`; add `genreAdjustments`/`bpmRangeAdjustments` to `WeightConfig`; apply genre/BPM range bonuses |
| Modify | `web/lib/aggregator.test.ts` | Test genre/BPM range bonus application |
| Modify | `web/lib/modelWeights.ts` | Read and return interaction weights from `ModelWeights` DB row |
| Modify | `web/features/search/server/searchApi.ts` | Read `seedGenre` in `loadAudioFeatures` |
| Modify | `web/features/feedback/server/trainApi.ts` | Pass `seedGenre`/`seedBpm` in samples; persist interaction weights to DB |

---

## Task 1: Parse genre in Beatport adapter

**Files:**
- Modify: `python-service/app/adapters/beatport.py:52-75`
- Modify: `python-service/tests/test_beatport.py:40-63`

The raw track dict already has `"genre": [{"genre_name": "Techno"}]`. Currently `_parse_track` ignores it.

- [ ] **Step 1: Write the failing test**

Add to `python-service/tests/test_beatport.py` after `test_parse_track_source_url_format`:

```python
def test_parse_track_populates_genre():
    result = _parse_track(_raw_track())
    assert result is not None
    assert result.genre == "Techno"


def test_parse_track_genre_missing_returns_none():
    result = _parse_track(_raw_track(genre=[]))
    assert result is not None
    assert result.genre is None


def test_parse_track_genre_no_genre_key():
    raw = _raw_track()
    del raw["genre"]
    result = _parse_track(raw)
    assert result is not None
    assert result.genre is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd python-service && .venv/bin/pytest tests/test_beatport.py::test_parse_track_populates_genre tests/test_beatport.py::test_parse_track_genre_missing_returns_none tests/test_beatport.py::test_parse_track_genre_no_genre_key -v
```

Expected: FAILED — `assert result.genre == "Techno"` fails because `result.genre is None`.

- [ ] **Step 3: Parse genre in `_parse_track`**

In `python-service/app/adapters/beatport.py`, update `_parse_track` (the `return TrackMeta(...)` block at line 67):

```python
    genres = t.get("genre") or []
    genre = genres[0].get("genre_name") if genres else None

    return TrackMeta(
        title=title,
        artist=artist,
        source="beatport",
        sourceUrl=f"https://www.beatport.com/track/{track_name.lower().replace(' ', '-')}/{track_id}",
        coverUrl=cover_url,
        bpm=t.get("bpm"),
        key=_to_camelot(t.get("key_name")),
        genre=genre,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd python-service && .venv/bin/pytest tests/test_beatport.py -v
```

Expected: all PASSED.

- [ ] **Step 5: Commit**

```bash
git add python-service/app/adapters/beatport.py python-service/tests/test_beatport.py
git commit -m "feat(beatport): parse genre from track response"
```

---

## Task 2: Python genre bucketing module

**Files:**
- Create: `python-service/app/core/genre_buckets.py`
- Create: `python-service/tests/test_genre_buckets.py`

- [ ] **Step 1: Write the failing tests**

Create `python-service/tests/test_genre_buckets.py`:

```python
"""Tests for genre bucketing and one-hot encoding."""
import pytest

from app.core.genre_buckets import GENRE_BUCKETS, BPM_RANGES, genre_to_bucket, genre_one_hot, bpm_range_features


@pytest.mark.parametrize("raw,expected_bucket", [
    ("Techno", "techno"),
    ("Hard Techno", "techno"),
    ("Industrial", "techno"),
    ("EBM", "techno"),
    ("House", "house"),
    ("Tech House", "house"),
    ("Deep House", "house"),
    ("Afro House", "house"),
    ("Melodic House & Techno", "house"),
    ("Progressive House", "house"),
    ("Drum & Bass", "drum_bass"),
    ("Jungle", "drum_bass"),
    ("Trance", "trance"),
    ("Psy-Trance", "trance"),
    ("Progressive Trance", "trance"),
    ("Breaks", "breaks"),
    ("Breakbeat", "breaks"),
    ("UK Garage", "breaks"),
    ("Ambient", "ambient"),
    ("Downtempo", "ambient"),
    ("Chillout", "ambient"),
    ("Unknown Genre XYZ", "other"),
    (None, "other"),
])
def test_genre_to_bucket(raw, expected_bucket):
    assert genre_to_bucket(raw) == expected_bucket


def test_genre_one_hot_techno():
    vec = genre_one_hot("techno")
    assert len(vec) == len(GENRE_BUCKETS)
    assert vec[GENRE_BUCKETS.index("techno")] == 1.0
    assert sum(vec) == 1.0


def test_genre_one_hot_other():
    vec = genre_one_hot("other")
    assert vec[GENRE_BUCKETS.index("other")] == 1.0
    assert sum(vec) == 1.0


def test_genre_one_hot_all_buckets_valid():
    for bucket in GENRE_BUCKETS:
        vec = genre_one_hot(bucket)
        assert sum(vec) == 1.0


@pytest.mark.parametrize("bpm,expected_range,expected_present", [
    (80.0, "slow", 1.0),
    (89.9, "slow", 1.0),
    (90.0, "mid", 1.0),
    (119.9, "mid", 1.0),
    (120.0, "fast", 1.0),
    (139.9, "fast", 1.0),
    (140.0, "vfast", 1.0),
    (175.0, "vfast", 1.0),
    (None, None, 0.0),
])
def test_bpm_range_features(bpm, expected_range, expected_present):
    one_hot, present = bpm_range_features(bpm)
    assert len(one_hot) == len(BPM_RANGES)
    assert present == expected_present
    if expected_range is not None:
        assert one_hot[BPM_RANGES.index(expected_range)] == 1.0
        assert sum(one_hot) == 1.0
    else:
        assert sum(one_hot) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd python-service && .venv/bin/pytest tests/test_genre_buckets.py -v
```

Expected: ERROR — `ModuleNotFoundError: No module named 'app.core.genre_buckets'`.

- [ ] **Step 3: Implement the module**

Create `python-service/app/core/genre_buckets.py`:

```python
GENRE_MAP: dict[str, str] = {
    "Techno": "techno",
    "Hard Techno": "techno",
    "Industrial": "techno",
    "EBM": "techno",
    "House": "house",
    "Tech House": "house",
    "Deep House": "house",
    "Afro House": "house",
    "Melodic House & Techno": "house",
    "Progressive House": "house",
    "Funky House": "house",
    "Jackin House": "house",
    "Drum & Bass": "drum_bass",
    "Jungle": "drum_bass",
    "Trance": "trance",
    "Psy-Trance": "trance",
    "Progressive Trance": "trance",
    "Breaks": "breaks",
    "Breakbeat": "breaks",
    "UK Garage": "breaks",
    "Ambient": "ambient",
    "Downtempo": "ambient",
    "Chillout": "ambient",
}

GENRE_BUCKETS: list[str] = ["techno", "house", "drum_bass", "trance", "breaks", "ambient", "other"]
BPM_RANGES: list[str] = ["slow", "mid", "fast", "vfast"]


def genre_to_bucket(genre: str | None) -> str:
    if genre is None:
        return "other"
    return GENRE_MAP.get(genre, "other")


def genre_one_hot(bucket: str) -> list[float]:
    return [1.0 if b == bucket else 0.0 for b in GENRE_BUCKETS]


def bpm_range_features(seed_bpm: float | None) -> tuple[list[float], float]:
    """Returns (bpm_range_one_hot, present_flag)."""
    if seed_bpm is None:
        return [0.0] * len(BPM_RANGES), 0.0
    if seed_bpm < 90:
        idx = 0
    elif seed_bpm < 120:
        idx = 1
    elif seed_bpm < 140:
        idx = 2
    else:
        idx = 3
    one_hot = [1.0 if i == idx else 0.0 for i in range(len(BPM_RANGES))]
    return one_hot, 1.0
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd python-service && .venv/bin/pytest tests/test_genre_buckets.py -v
```

Expected: all PASSED.

- [ ] **Step 5: Commit**

```bash
git add python-service/app/core/genre_buckets.py python-service/tests/test_genre_buckets.py
git commit -m "feat(ml): add genre bucketing module for model conditioning"
```

---

## Task 3: Extend Python models

**Files:**
- Modify: `python-service/app/core/models.py:105-134`

- [ ] **Step 1: Add `seedGenre` and `seedBpm` to `SampleFeatures`**

In `python-service/app/core/models.py`, update `SampleFeatures` (lines 105–113):

```python
class SampleFeatures(BaseModel):
    appearances: list[SourceAppearance]
    numSources: int
    minSourceRank: int
    cosineScore: float | None
    rrfScore: float
    bpmDelta: float | None = None
    keyCompatible: bool | None = None
    seedGenre: str | None = None   # raw Beatport genre string; bucketed in _build_feature_vector
    seedBpm: float | None = None   # absolute seed BPM for conditioning (not delta)
```

- [ ] **Step 2: Add interaction weight fields to `TrainingResult`**

Update `TrainingResult` (lines 124–134):

```python
class TrainingResult(BaseModel):
    source_weights: dict[str, float]
    cosine_score_weight: float
    num_sources_weight: float
    bpm_delta_weight: float
    bpm_compatible_weight: float
    bpm_present_weight: float
    key_compatible_weight: float
    key_present_weight: float
    rank_decay_k: float
    sample_size: int
    genre_adjustments: dict[str, dict[str, float]]   # {genre_bucket: {source: weight, "cosine_score": weight}}
    bpm_range_adjustments: dict[str, dict[str, float]]  # {bpm_range: {"bpmDelta": weight, "bpmCompatible": weight}}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd python-service && .venv/bin/pytest tests/test_train.py -v
```

Expected: all PASSED (new optional fields on `SampleFeatures` don't break existing `_sample` helper; `TrainingResult` new fields will fail until Task 4 implements them — skip for now if they fail).

- [ ] **Step 4: Commit**

```bash
git add python-service/app/core/models.py
git commit -m "feat(ml): extend SampleFeatures and TrainingResult with genre/BPM conditioning fields"
```

---

## Task 4: Extend feature vector builder and train route

**Files:**
- Modify: `python-service/app/api/routes/train.py`
- Modify: `python-service/tests/test_train.py`

- [ ] **Step 1: Write failing tests for the extended feature vector and interaction weight extraction**

Add to `python-service/tests/test_train.py` — first update the `_sample` helper signature:

```python
def _sample(*, sources_at_rank: dict[str, int], is_similar: bool,
            cosine_score: float | None = None, num_sources_override: int | None = None,
            bpm_delta: float | None = None, key_compatible: bool | None = None,
            seed_genre: str | None = None, seed_bpm: float | None = None) -> TrainingSample:
    appearances = [SourceAppearance(source=s, rank=r) for s, r in sources_at_rank.items()]
    n = num_sources_override if num_sources_override is not None else len(appearances)
    return TrainingSample(
        features=SampleFeatures(
            appearances=appearances,
            numSources=n,
            minSourceRank=min((a.rank for a in appearances), default=999),
            cosineScore=cosine_score,
            rrfScore=0.0,
            bpmDelta=bpm_delta,
            keyCompatible=key_compatible,
            seedGenre=seed_genre,
            seedBpm=seed_bpm,
        ),
        is_similar=is_similar,
    )
```

Then add these new tests at the bottom of `test_train.py`:

```python
from app.api.routes.train import _build_feature_vector, SOURCES
from app.core.genre_buckets import GENRE_BUCKETS, BPM_RANGES


def test_feature_vector_length():
    """Feature vector must be exactly 90 elements."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True).features
    vec = _build_feature_vector(f)
    # 7 sources + 1 cosine + 1 numSources + 1 bpmDelta + 1 bpmCompat + 1 bpmPresent
    # + 1 keyCompat + 1 keyPresent + 7 genre + 4 bpmRange + 1 bpmRangePresent
    # + 49 genre×source + 7 genre×cosine + 4 bpmRange×bpmDelta + 4 bpmRange×bpmCompat = 90
    assert len(vec) == 90


def test_feature_vector_genre_one_hot_techno():
    """Genre one-hot at position 14-20 is [1,0,0,0,0,0,0] for techno."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True,
                seed_genre="Techno").features
    vec = _build_feature_vector(f)
    genre_slice = vec[14:21]
    assert genre_slice[0] == 1.0  # techno is first bucket
    assert sum(genre_slice) == 1.0


def test_feature_vector_genre_unknown_falls_to_other():
    """Unmapped genre falls to 'other' bucket (last position in genre slice)."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True,
                seed_genre="Polka").features
    vec = _build_feature_vector(f)
    genre_slice = vec[14:21]
    assert genre_slice[-1] == 1.0  # other is last bucket
    assert sum(genre_slice) == 1.0


def test_feature_vector_bpm_range_fast():
    """Seed BPM 130 falls in 'fast' bucket (index 2 of 4)."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True,
                seed_bpm=130.0).features
    vec = _build_feature_vector(f)
    bpm_slice = vec[21:25]
    assert bpm_slice[2] == 1.0  # fast
    assert vec[25] == 1.0        # bpmRangePresent


def test_feature_vector_bpm_range_absent():
    """No seed BPM → all BPM range features are 0."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True).features
    vec = _build_feature_vector(f)
    assert vec[21:26] == [0.0, 0.0, 0.0, 0.0, 0.0]


def test_genre_source_interaction_nonzero_when_matched():
    """genre_techno × beatport_rank_score is nonzero only when seed is Techno and candidate is in Beatport."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True,
                seed_genre="Techno").features
    vec = _build_feature_vector(f)
    # genre×source block starts at index 26
    # techno is bucket 0, beatport is source 0
    # index = 26 + (0 * 7) + 0 = 26
    assert vec[26] > 0.0


def test_genre_source_interaction_zero_when_genre_other():
    """Interaction features for techno×beatport are 0 when genre is unknown."""
    f = _sample(sources_at_rank={"beatport": 1}, is_similar=True,
                seed_genre=None).features
    vec = _build_feature_vector(f)
    # genre is 'other' (index 6), so all non-other genre×source interactions are 0
    # techno×beatport = vec[26]
    assert vec[26] == 0.0


async def test_train_returns_genre_adjustments():
    """Trained model returns genre_adjustments dict with all genre buckets."""
    random.seed(99)
    samples = []
    # Techno seeds → beatport is strongly predictive
    for _ in range(60):
        samples.append(_sample(sources_at_rank={"beatport": random.randint(1, 5)},
                               is_similar=True, seed_genre="Techno", seed_bpm=135.0))
        samples.append(_sample(sources_at_rank={"lastfm": random.randint(1, 5)},
                               is_similar=False, seed_genre="Techno", seed_bpm=135.0))
    result = await train_weights(TrainingRequest(samples=samples))
    assert set(result.genre_adjustments.keys()) == set(GENRE_BUCKETS)
    for bucket, adj in result.genre_adjustments.items():
        assert set(SOURCES + ["cosine_score"]).issuperset(adj.keys())


async def test_train_returns_bpm_range_adjustments():
    """Trained model returns bpm_range_adjustments dict with all BPM ranges."""
    random.seed(99)
    samples = []
    for _ in range(60):
        samples.append(_sample(sources_at_rank={"beatport": 1}, is_similar=True,
                               seed_bpm=135.0, bpm_delta=2.0))
        samples.append(_sample(sources_at_rank={"lastfm": 1}, is_similar=False,
                               seed_bpm=135.0, bpm_delta=20.0))
    result = await train_weights(TrainingRequest(samples=samples))
    assert set(result.bpm_range_adjustments.keys()) == set(BPM_RANGES)
    for rng, adj in result.bpm_range_adjustments.items():
        assert "bpmDelta" in adj
        assert "bpmCompatible" in adj
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd python-service && .venv/bin/pytest tests/test_train.py::test_feature_vector_length tests/test_train.py::test_genre_source_interaction_nonzero_when_matched -v
```

Expected: FAILED — `_build_feature_vector` imported from `train.py` doesn't exist yet for the new tests; or feature vector is length 14, not 90.

- [ ] **Step 3: Rewrite `python-service/app/api/routes/train.py`**

Replace the entire file with:

```python
import numpy as np
from fastapi import APIRouter, HTTPException
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.core.genre_buckets import (
    GENRE_BUCKETS, BPM_RANGES,
    genre_to_bucket, genre_one_hot, bpm_range_features,
)
from app.core.models import SampleFeatures, TrainingRequest, TrainingResult

router = APIRouter()

SOURCES = ["cosine_club", "youtube_music", "yandex_music", "lastfm", "trackidnet", "soundcloud", "lastfm_hop"]
RANK_DECAY_K = 60.0
MIN_SAMPLES = 20
BPM_DELTA_CAP = 24.0
BPM_COMPATIBLE_MAX = 6.0
LR_C = 0.1
SOURCE_WEIGHT_CLIP = (0.3, 3.0)
AUDIO_WEIGHT_CLIP = (-2.0, 2.0)

# Feature vector index constants — must match order in _build_feature_vector.
_N_SOURCES = len(SOURCES)           # 7
_N_GENRE = len(GENRE_BUCKETS)       # 7
_N_BPM_RANGE = len(BPM_RANGES)      # 4
_BASE_FEATURES = 14                 # 7 sources + cosine + numSources + bpmDelta + bpmCompat + bpmPresent + keyCompat + keyPresent
GENRE_FEATURES_START = _BASE_FEATURES                        # 14
BPM_RANGE_START = GENRE_FEATURES_START + _N_GENRE            # 21
BPM_RANGE_PRESENT_IDX = BPM_RANGE_START + _N_BPM_RANGE      # 25
GENRE_SOURCE_INTERACTION_START = BPM_RANGE_PRESENT_IDX + 1  # 26
GENRE_COSINE_INTERACTION_START = GENRE_SOURCE_INTERACTION_START + _N_GENRE * _N_SOURCES  # 75
BPM_DELTA_INTERACTION_START = GENRE_COSINE_INTERACTION_START + _N_GENRE                 # 82
BPM_COMPAT_INTERACTION_START = BPM_DELTA_INTERACTION_START + _N_BPM_RANGE               # 86
TOTAL_FEATURES = BPM_COMPAT_INTERACTION_START + _N_BPM_RANGE                            # 90


def _build_feature_vector(f: SampleFeatures) -> list[float]:
    source_ranks = {a.source: a.rank for a in f.appearances}
    source_features = [
        1.0 / (RANK_DECAY_K + source_ranks[s]) if s in source_ranks else 0.0
        for s in SOURCES
    ]
    if f.bpmDelta is None:
        bpm_delta_norm = 0.0
        bpm_compatible = 0.0
        bpm_present = 0.0
    else:
        bpm_delta_norm = min(f.bpmDelta / BPM_DELTA_CAP, 1.0)
        bpm_compatible = 1.0 if f.bpmDelta <= BPM_COMPATIBLE_MAX else 0.0
        bpm_present = 1.0
    key_compatible = 1.0 if f.keyCompatible is True else 0.0
    key_present = 1.0 if f.keyCompatible is not None else 0.0

    bucket = genre_to_bucket(f.seedGenre)
    g_one_hot = genre_one_hot(bucket)
    bpm_range_one_hot, bpm_range_present = bpm_range_features(f.seedBpm)

    cosine_val = f.cosineScore or 0.0

    # Interaction: genre bucket × per-source rank scores (7×7 = 49)
    genre_source_interactions = [g * s for g in g_one_hot for s in source_features]

    # Interaction: genre bucket × cosine score (7)
    genre_cosine_interactions = [g * cosine_val for g in g_one_hot]

    # Interaction: BPM range × bpmDeltaNorm and × bpmCompatible (4 each)
    bpm_range_delta_interactions = [r * bpm_delta_norm for r in bpm_range_one_hot]
    bpm_range_compat_interactions = [r * bpm_compatible for r in bpm_range_one_hot]

    return [
        *source_features,             # 7  (indices 0-6)
        cosine_val,                   # 1  (index 7)
        f.numSources / len(SOURCES),  # 1  (index 8)
        bpm_delta_norm,               # 1  (index 9)
        bpm_compatible,               # 1  (index 10)
        bpm_present,                  # 1  (index 11)
        key_compatible,               # 1  (index 12)
        key_present,                  # 1  (index 13)
        *g_one_hot,                   # 7  (indices 14-20)
        *bpm_range_one_hot,           # 4  (indices 21-24)
        bpm_range_present,            # 1  (index 25)
        *genre_source_interactions,   # 49 (indices 26-74)
        *genre_cosine_interactions,   # 7  (indices 75-81)
        *bpm_range_delta_interactions, # 4 (indices 82-85)
        *bpm_range_compat_interactions, # 4 (indices 86-89)
    ]


@router.post(
    "/train",
    operation_id="train_weights",
    response_model=TrainingResult,
)
async def train_weights(req: TrainingRequest) -> TrainingResult:
    if len(req.samples) < MIN_SAMPLES:
        raise HTTPException(
            status_code=422,
            detail=f"Need at least {MIN_SAMPLES} labeled samples to train, got {len(req.samples)}.",
        )

    X = np.array([_build_feature_vector(s.features) for s in req.samples])
    y = np.array([s.is_similar for s in req.samples])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = LogisticRegression(C=LR_C, max_iter=1000, solver="lbfgs")
    model.fit(X_scaled, y)

    coef = model.coef_[0] / scaler.scale_

    src_lo, src_hi = SOURCE_WEIGHT_CLIP
    aud_lo, aud_hi = AUDIO_WEIGHT_CLIP

    source_weights = {
        source: float(np.clip(coef[i], src_lo, src_hi))
        for i, source in enumerate(SOURCES)
    }

    n = _N_SOURCES

    # Genre × source adjustments — includes cosine_score as a special source key
    genre_adjustments: dict[str, dict[str, float]] = {}
    for gi, genre in enumerate(GENRE_BUCKETS):
        d: dict[str, float] = {}
        for si, source in enumerate(SOURCES):
            idx = GENRE_SOURCE_INTERACTION_START + gi * _N_SOURCES + si
            d[source] = float(np.clip(coef[idx], src_lo, src_hi))
        cosine_idx = GENRE_COSINE_INTERACTION_START + gi
        d["cosine_score"] = float(np.clip(coef[cosine_idx], aud_lo, aud_hi))
        genre_adjustments[genre] = d

    # BPM range × bpmDelta/bpmCompatible adjustments
    bpm_range_adjustments: dict[str, dict[str, float]] = {}
    for ri, rng in enumerate(BPM_RANGES):
        bpm_range_adjustments[rng] = {
            "bpmDelta": float(np.clip(coef[BPM_DELTA_INTERACTION_START + ri], aud_lo, aud_hi)),
            "bpmCompatible": float(np.clip(coef[BPM_COMPAT_INTERACTION_START + ri], aud_lo, aud_hi)),
        }

    return TrainingResult(
        source_weights=source_weights,
        cosine_score_weight=float(np.clip(coef[n], aud_lo, aud_hi)),
        num_sources_weight=float(np.clip(coef[n + 1], aud_lo, aud_hi)),
        bpm_delta_weight=float(np.clip(coef[n + 2], aud_lo, aud_hi)),
        bpm_compatible_weight=float(np.clip(coef[n + 3], aud_lo, aud_hi)),
        bpm_present_weight=float(np.clip(coef[n + 4], aud_lo, aud_hi)),
        key_compatible_weight=float(np.clip(coef[n + 5], aud_lo, aud_hi)),
        key_present_weight=float(np.clip(coef[n + 6], aud_lo, aud_hi)),
        rank_decay_k=RANK_DECAY_K,
        sample_size=len(req.samples),
        genre_adjustments=genre_adjustments,
        bpm_range_adjustments=bpm_range_adjustments,
    )
```

- [ ] **Step 4: Run all train tests**

```bash
cd python-service && .venv/bin/pytest tests/test_train.py tests/test_genre_buckets.py -v
```

Expected: all PASSED.

- [ ] **Step 5: Commit**

```bash
git add python-service/app/api/routes/train.py python-service/tests/test_train.py
git commit -m "feat(ml): extend feature vector with genre/BPM buckets and interaction terms (14→90 features)"
```

---

## Task 5: Sync TypeScript generated types

**Files:**
- Run: `pnpm codegen` (repo root)
- Generated: `web/lib/python-api/generated/types/SampleFeatures.ts`
- Generated: `web/lib/python-api/generated/zod/sampleFeaturesSchema.ts`
- Generated: any `TrainingResult` generated type files

- [ ] **Step 1: Run codegen**

```bash
pnpm codegen
```

Expected: exits 0, updated files in `web/lib/python-api/generated/`.

- [ ] **Step 2: Verify SampleFeatures.ts includes new fields**

Open `web/lib/python-api/generated/types/SampleFeatures.ts` and confirm it now contains:

```typescript
seedGenre?: string | null;
seedBpm?: number | null;
```

- [ ] **Step 3: Commit generated files**

```bash
git add web/lib/python-api/generated/
git commit -m "chore: regen kubb client after SampleFeatures + TrainingResult model changes"
```

---

## Task 6: Prisma schema migration

**Files:**
- Modify: `web/prisma/schema.prisma`

- [ ] **Step 1: Add `seedGenre` to `SearchQuery` and JSON weight fields to `ModelWeights`**

In `web/prisma/schema.prisma`, update `SearchQuery`:

```prisma
model SearchQuery {
    id                 String               @id @default(cuid())
    input              String
    cacheKey           String?
    status             String               @default("pending")
    seedBpm            Float?
    seedMusicalKey     String?
    seedGenre          String?
    createdAt          DateTime             @default(now())
    results            SearchResult[]
    similarityFeedback SimilarityFeedback[]

    @@index([cacheKey, status, createdAt])
}
```

Update `ModelWeights` — add two JSON fields after `keyPresentWeight`:

```prisma
model ModelWeights {
    id                  String         @id @default(cuid())
    version             Int            @unique
    trainedAt           DateTime
    sampleSize          Int
    rankDecayK          Float
    cosineScoreWeight   Float
    numSourcesWeight    Float
    bpmDeltaWeight      Float?
    bpmCompatibleWeight Float?
    bpmPresentWeight    Float?
    keyCompatibleWeight Float?
    keyPresentWeight    Float?
    genreAdjustments    Json?
    bpmRangeAdjustments Json?
    sourceWeights       SourceWeight[]
}
```

- [ ] **Step 2: Run migration**

```bash
cd web && pnpm exec prisma migrate dev --name seed-genre-conditioning
```

Expected: migration created and applied, Prisma client regenerated at `app/generated/prisma`.

- [ ] **Step 3: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/
git commit -m "feat(db): add seedGenre to SearchQuery and interaction weight fields to ModelWeights"
```

---

## Task 7: TypeScript genre bucket map

**Files:**
- Create: `web/lib/genreBuckets.ts`

This mirrors `python-service/app/core/genre_buckets.py`. Both must stay in sync when genre mappings change.

- [ ] **Step 1: Create the module**

Create `web/lib/genreBuckets.ts`:

```typescript
// Must stay in sync with python-service/app/core/genre_buckets.py GENRE_MAP.
export const GENRE_MAP: Record<string, string> = {
  "Techno": "techno",
  "Hard Techno": "techno",
  "Industrial": "techno",
  "EBM": "techno",
  "House": "house",
  "Tech House": "house",
  "Deep House": "house",
  "Afro House": "house",
  "Melodic House & Techno": "house",
  "Progressive House": "house",
  "Funky House": "house",
  "Jackin House": "house",
  "Drum & Bass": "drum_bass",
  "Jungle": "drum_bass",
  "Trance": "trance",
  "Psy-Trance": "trance",
  "Progressive Trance": "trance",
  "Breaks": "breaks",
  "Breakbeat": "breaks",
  "UK Garage": "breaks",
  "Ambient": "ambient",
  "Downtempo": "ambient",
  "Chillout": "ambient",
};

export function genreToBucket(genre: string | null | undefined): string {
  if (!genre) return "other";
  return GENRE_MAP[genre] ?? "other";
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/genreBuckets.ts
git commit -m "feat(web): add TypeScript genre bucket map"
```

---

## Task 8: Persist seedGenre in background enrichment

**Files:**
- Modify: `web/features/enrichment/server/enqueueBackgroundEnrich.ts`

- [ ] **Step 1: Update `enrichSeed` to write `seedGenre` and extend skip guard**

Replace the `enrichSeed` function in `web/features/enrichment/server/enqueueBackgroundEnrich.ts`:

```typescript
import { genreToBucket } from "@/lib/genreBuckets";

async function enrichSeed(
  searchId: SearchQueryId,
  seed: { artist: string; title: string | null },
  pythonServiceUrl: string,
): Promise<void> {
  if (!seed.title) return;

  const existing = await prisma.searchQuery.findUnique({
    where: { id: searchId },
    select: { seedBpm: true, seedMusicalKey: true, seedGenre: true },
  });
  if (existing?.seedBpm != null && existing?.seedMusicalKey != null && existing?.seedGenre != null) return;

  const seedPseudoTrack: TrackMeta = {
    title: seed.title,
    artist: seed.artist,
    source: "seed",
    sourceUrl: `seed://${searchId}`,
  };

  try {
    const resp = await enrichAudioFeatures({ tracks: [seedPseudoTrack] }, { baseURL: pythonServiceUrl });
    const enriched = resp.tracks[0];
    if (!enriched) return;
    if (enriched.bpm == null && enriched.key == null && enriched.genre == null) return;

    const rawGenre = enriched.genre ?? null;
    const genreBucket: string | undefined = rawGenre != null ? genreToBucket(rawGenre) : undefined;

    await prisma.searchQuery.update({
      where: { id: searchId },
      data: {
        seedBpm: enriched.bpm ?? undefined,
        seedMusicalKey: enriched.key ?? undefined,
        seedGenre: genreBucket,
      },
    });
  } catch (err) {
    console.error("[enrichment-queue] seed /enrich failed:", err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/features/enrichment/server/enqueueBackgroundEnrich.ts
git commit -m "feat(enrichment): persist seedGenre bucket after Beatport seed enrichment"
```

---

## Task 9: Update WeightConfig, AudioFeatures, and aggregator scoring

**Files:**
- Modify: `web/lib/aggregator.ts`
- Modify: `web/lib/aggregator.test.ts`

- [ ] **Step 1: Write failing aggregator tests for genre/BPM adjustments**

Add to `web/lib/aggregator.test.ts` (import `aggregateTracks` at the top if not already imported):

```typescript
import { aggregateTracks, rrfFuse, normalizeArtist, normalizeTitle } from "./aggregator";
import type { WeightConfig, AudioFeatures } from "./aggregator";

// ... existing tests ...

describe("genre and BPM range adjustments", () => {
  const baseWeights: WeightConfig = {
    rankDecayK: 60,
    cosineScoreWeight: 0,
    numSourcesWeight: 0,
    bpmDeltaWeight: 0,
    bpmCompatibleWeight: 0,
    bpmPresentWeight: 0,
    keyCompatibleWeight: 0,
    keyPresentWeight: 0,
    sourceWeights: {},
    genreAdjustments: {},
    bpmRangeAdjustments: {},
  };

  it("genre × source adjustment boosts beatport candidate when seed is techno", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", sourceUrl: "https://beatport.com/a" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB", sourceUrl: "https://lastfm.com/b" });
    const lists: SourceList[] = [
      { source: "beatport", tracks: [trackA] },
      { source: "lastfm", tracks: [trackB] },
    ];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      genreAdjustments: {
        techno: { beatport: 2.0, lastfm: 0.3 },
      },
    };
    const audio: AudioFeatures = {
      seedBpm: null,
      seedMusicalKey: null,
      seedGenre: "techno",
      candidateBpm: new Map(),
      candidateMusicalKey: new Map(),
    };
    const result = aggregateTracks(lists, weightsWithAdj, audio);
    // beatport gets a large genre adjustment, so trackA should rank higher
    const scoreA = result.find((t) => t.title === "A")!.rrfScore;
    const scoreB = result.find((t) => t.title === "B")!.rrfScore;
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it("genre adjustment is no-op when seedGenre is null", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", sourceUrl: "https://beatport.com/a" });
    const trackB = makeTrack({ title: "B", artist: "ArtistB", sourceUrl: "https://lastfm.com/b" });
    const lists: SourceList[] = [
      { source: "beatport", tracks: [trackA] },
      { source: "lastfm", tracks: [trackB] },
    ];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      genreAdjustments: { techno: { beatport: 2.0 } },
    };
    const audio: AudioFeatures = {
      seedBpm: null,
      seedMusicalKey: null,
      seedGenre: null,
      candidateBpm: new Map(),
      candidateMusicalKey: new Map(),
    };
    const result = aggregateTracks(lists, weightsWithAdj, audio);
    // Both have rank 1 in their respective sources, no adjustment → equal base RRF
    const scoreA = result.find((t) => t.title === "A")!.rrfScore;
    const scoreB = result.find((t) => t.title === "B")!.rrfScore;
    expect(scoreA).toBeCloseTo(scoreB, 5);
  });

  it("BPM range adjustment modifies bpmDelta bonus for matching range", () => {
    const trackA = makeTrack({ title: "A", artist: "ArtistA", sourceUrl: "https://beatport.com/a" });
    const lists: SourceList[] = [{ source: "beatport", tracks: [trackA] }];
    const weightsWithAdj: WeightConfig = {
      ...baseWeights,
      bpmRangeAdjustments: { fast: { bpmDelta: 1.5, bpmCompatible: 1.0 } },
    };
    const audioWithBpm: AudioFeatures = {
      seedBpm: 130,
      seedMusicalKey: null,
      seedGenre: "techno",
      candidateBpm: new Map([["https://beatport.com/a", 132]]),
      candidateMusicalKey: new Map(),
    };
    const audioNoBpm: AudioFeatures = {
      ...audioWithBpm,
      seedBpm: null,
      candidateBpm: new Map(),
    };
    const withBpm = aggregateTracks(lists, weightsWithAdj, audioWithBpm);
    const withoutBpm = aggregateTracks(lists, weightsWithAdj, audioNoBpm);
    expect(withBpm[0]!.rrfScore).toBeGreaterThan(withoutBpm[0]!.rrfScore);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd web && pnpm test -- --reporter=verbose aggregator
```

Expected: type errors on `genreAdjustments` / `bpmRangeAdjustments` not on `WeightConfig`; `seedGenre` not on `AudioFeatures`.

- [ ] **Step 3: Update `WeightConfig`, `AudioFeatures`, `DEFAULT_WEIGHTS`, and `EMPTY_AUDIO_FEATURES` in `aggregator.ts`**

In `web/lib/aggregator.ts`, update the types and defaults:

```typescript
export type WeightConfig = {
  rankDecayK: number;
  cosineScoreWeight: number;
  numSourcesWeight: number;
  bpmDeltaWeight: number;
  bpmCompatibleWeight: number;
  bpmPresentWeight: number;
  keyCompatibleWeight: number;
  keyPresentWeight: number;
  sourceWeights: Partial<Record<string, number>>;
  genreAdjustments: Partial<Record<string, Partial<Record<string, number>>>>;
  bpmRangeAdjustments: Partial<Record<string, Partial<Record<string, number>>>>;
};

export const DEFAULT_WEIGHTS: WeightConfig = {
  rankDecayK: RRF_K,
  cosineScoreWeight: 0,
  numSourcesWeight: 0,
  bpmDeltaWeight: 0,
  bpmCompatibleWeight: 0,
  bpmPresentWeight: 0,
  keyCompatibleWeight: 0,
  keyPresentWeight: 0,
  sourceWeights: {},
  genreAdjustments: {},
  bpmRangeAdjustments: {},
};

export type AudioFeatures = {
  seedBpm: number | null;
  seedMusicalKey: string | null;
  seedGenre: string | null;
  candidateBpm: Map<string, number | null>;
  candidateMusicalKey: Map<string, string | null>;
};

export const EMPTY_AUDIO_FEATURES: AudioFeatures = {
  seedBpm: null,
  seedMusicalKey: null,
  seedGenre: null,
  candidateBpm: new Map(),
  candidateMusicalKey: new Map(),
};
```

- [ ] **Step 4: Add `getBpmRange` helper and `decorateWithGenreAndBpmAdjustments` function in `aggregator.ts`**

Add after `clipBonus` and before `decorateWithAudioBonus`:

```typescript
function getBpmRange(bpm: number): string {
  if (bpm < 90) return "slow";
  if (bpm < 120) return "mid";
  if (bpm < 140) return "fast";
  return "vfast";
}

function decorateWithGenreAndBpmAdjustments(
  candidates: FusedCandidate[],
  weights: WeightConfig,
  audio: AudioFeatures,
): void {
  const genreAdj = audio.seedGenre ? (weights.genreAdjustments[audio.seedGenre] ?? {}) : {};
  const bpmRange = audio.seedBpm != null ? getBpmRange(audio.seedBpm) : null;
  const bpmRangeAdj = bpmRange ? (weights.bpmRangeAdjustments[bpmRange] ?? {}) : {};

  for (const c of candidates) {
    // Genre × source rank adjustments
    for (const { source, rank } of c.appearances) {
      const adj = genreAdj[source] ?? 0;
      if (adj !== 0) {
        c.rrfScore += clipBonus(adj, 1.0 / (weights.rankDecayK + rank));
      }
    }

    // Genre × cosine score adjustment
    if (c.cosineScore != null) {
      const cosAdj = genreAdj["cosine_score"] ?? 0;
      if (cosAdj !== 0) c.rrfScore += clipBonus(cosAdj, c.cosineScore);
    }

    // BPM range × bpmDelta/bpmCompatible adjustments
    if (bpmRange && audio.seedBpm != null) {
      const candBpm = audio.candidateBpm.get(c.sourceUrl) ?? null;
      if (candBpm != null) {
        const bpmDelta = Math.abs(audio.seedBpm - candBpm);
        const bpmDeltaNorm = Math.min(bpmDelta / BPM_DELTA_CAP_BPM, 1);
        const bpmCompatible = bpmDelta <= BPM_COMPATIBLE_MAX_BPM ? 1 : 0;
        const deltaAdj = bpmRangeAdj["bpmDelta"] ?? 0;
        const compatAdj = bpmRangeAdj["bpmCompatible"] ?? 0;
        if (deltaAdj !== 0) c.rrfScore += clipBonus(deltaAdj, bpmDeltaNorm);
        if (compatAdj !== 0) c.rrfScore += clipBonus(compatAdj, bpmCompatible);
      }
    }
  }
}
```

- [ ] **Step 5: Call `decorateWithGenreAndBpmAdjustments` in `aggregateTracks`**

Update the `aggregateTracks` function body to add step 2b after the existing `decorateWithAudioBonus` call:

```typescript
export function aggregateTracks(
  sourceLists: SourceList[],
  weights: WeightConfig = DEFAULT_WEIGHTS,
  audio: AudioFeatures = EMPTY_AUDIO_FEATURES,
): FusedCandidate[] {
  const fused = rrfFuse(sourceLists, weights);
  decorateWithAudioBonus(fused, weights, audio);
  decorateWithGenreAndBpmAdjustments(fused, weights, audio);  // ← new
  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  for (const t of fused) {
    t.score = t.rrfScore;
  }
  return diversifyArtists(fused);
}
```

- [ ] **Step 6: Run aggregator tests**

```bash
cd web && pnpm test -- --reporter=verbose aggregator
```

Expected: all PASSED.

- [ ] **Step 7: Commit**

```bash
git add web/lib/aggregator.ts web/lib/aggregator.test.ts
git commit -m "feat(aggregator): apply genre/BPM range interaction bonuses at scoring time"
```

---

## Task 10: Update `getActiveWeights`

**Files:**
- Modify: `web/lib/modelWeights.ts`

- [ ] **Step 1: Read and return interaction weights from DB**

Replace `web/lib/modelWeights.ts`:

```typescript
import type { WeightConfig } from "@/lib/aggregator";
import { DEFAULT_WEIGHTS } from "@/lib/aggregator";
import { prisma } from "@/lib/prisma";

export async function getActiveWeights(): Promise<WeightConfig> {
  const row = await prisma.modelWeights.findFirst({
    orderBy: { version: "desc" },
    include: { sourceWeights: true },
  });
  if (!row) return DEFAULT_WEIGHTS;
  return {
    rankDecayK: row.rankDecayK,
    cosineScoreWeight: row.cosineScoreWeight,
    numSourcesWeight: row.numSourcesWeight,
    bpmDeltaWeight: row.bpmDeltaWeight ?? 0,
    bpmCompatibleWeight: row.bpmCompatibleWeight ?? 0,
    bpmPresentWeight: row.bpmPresentWeight ?? 0,
    keyCompatibleWeight: row.keyCompatibleWeight ?? 0,
    keyPresentWeight: row.keyPresentWeight ?? 0,
    sourceWeights: Object.fromEntries(row.sourceWeights.map((sw) => [sw.source, sw.weight])),
    genreAdjustments: (row.genreAdjustments as WeightConfig["genreAdjustments"]) ?? {},
    bpmRangeAdjustments: (row.bpmRangeAdjustments as WeightConfig["bpmRangeAdjustments"]) ?? {},
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/modelWeights.ts
git commit -m "feat(weights): load genre and BPM range interaction weights from ModelWeights"
```

---

## Task 11: Update searchApi — read seedGenre in loadAudioFeatures

**Files:**
- Modify: `web/features/search/server/searchApi.ts:181-202`

- [ ] **Step 1: Add `seedGenre` to the `loadAudioFeatures` query and return value**

In `web/features/search/server/searchApi.ts`, update `loadAudioFeatures`:

```typescript
async function loadAudioFeatures(
  cacheKey: string,
  sourceLists: { tracks: { sourceUrl: string }[] }[],
): Promise<AudioFeatures> {
  const seedPromise = prisma.searchQuery.findFirst({
    where: { cacheKey, seedBpm: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { seedBpm: true, seedMusicalKey: true, seedGenre: true },
  });

  const urls = sourceLists.flatMap((l) => l.tracks.map((t) => t.sourceUrl));
  const tracksPromise = urls.length
    ? prisma.track.findMany({
        where: { sourceUrl: { in: urls } },
        select: { sourceUrl: true, bpm: true, musicalKey: true },
      })
    : Promise.resolve([]);

  const [seed, tracks] = await Promise.all([seedPromise, tracksPromise]);

  return {
    seedBpm: seed?.seedBpm ?? null,
    seedMusicalKey: seed?.seedMusicalKey ?? null,
    seedGenre: seed?.seedGenre ?? null,
    candidateBpm: new Map(tracks.map((t) => [t.sourceUrl, t.bpm])),
    candidateMusicalKey: new Map(tracks.map((t) => [t.sourceUrl, t.musicalKey])),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/features/search/server/searchApi.ts
git commit -m "feat(search): thread seedGenre into AudioFeatures for scoring"
```

---

## Task 12: Update trainApi — pass seedGenre/seedBpm and persist interaction weights

**Files:**
- Modify: `web/features/feedback/server/trainApi.ts`

- [ ] **Step 1: Add `seedGenre` to the SearchQuery select**

In `web/features/feedback/server/trainApi.ts`, update the `searchQueries` query in the `Promise.all`:

```typescript
prisma.searchQuery.findMany({
  where: { id: { in: searchIds } },
  select: { id: true, seedBpm: true, seedMusicalKey: true, seedGenre: true },
}),
```

- [ ] **Step 2: Include `seedGenre` and `seedBpm` in the sample features**

Update the `samples` flatMap:

```typescript
  const samples = feedback.flatMap((f) => {
    const raw = featuresByKey.get(`${f.searchQueryId}:${f.trackId}`);
    const parsed = TrackFeaturesSchema.safeParse(raw);
    if (!parsed.success) return [];

    const sq = sqById.get(f.searchQueryId);
    const tr = trackById.get(f.trackId);
    const bpmDelta = sq?.seedBpm != null && tr?.bpm != null ? Math.abs(sq.seedBpm - tr.bpm) : null;
    const keyCompatible =
      sq?.seedMusicalKey != null && tr?.musicalKey != null
        ? isCamelotCompatible(sq.seedMusicalKey, tr.musicalKey)
        : null;

    return [
      {
        features: {
          ...parsed.data,
          bpmDelta,
          keyCompatible,
          seedGenre: sq?.seedGenre ?? null,
          seedBpm: sq?.seedBpm ?? null,
        },
        is_similar: f.isSimilar,
      },
    ];
  });
```

- [ ] **Step 3: Persist interaction weights when saving the new ModelWeights row**

Update the `prisma.modelWeights.create` call:

```typescript
  await prisma.modelWeights.create({
    data: {
      version: nextVersion,
      trainedAt: new Date(),
      sampleSize: result.sample_size,
      rankDecayK: result.rank_decay_k,
      cosineScoreWeight: result.cosine_score_weight,
      numSourcesWeight: result.num_sources_weight,
      bpmDeltaWeight: result.bpm_delta_weight,
      bpmCompatibleWeight: result.bpm_compatible_weight,
      bpmPresentWeight: result.bpm_present_weight,
      keyCompatibleWeight: result.key_compatible_weight,
      keyPresentWeight: result.key_present_weight,
      genreAdjustments: result.genre_adjustments as object,
      bpmRangeAdjustments: result.bpm_range_adjustments as object,
      sourceWeights: {
        create: Object.entries(result.source_weights).map(([source, weight]) => ({
          source: source as SimilaritySource,
          weight,
        })),
      },
    },
  });
```

- [ ] **Step 4: Run TypeScript lint to verify no type errors**

```bash
cd web && pnpm lint
```

Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add web/features/feedback/server/trainApi.ts
git commit -m "feat(train): pass seedGenre/seedBpm to Python and persist interaction weights"
```

---

## Task 13: Full integration smoke test

- [ ] **Step 1: Start both services**

```bash
pnpm dev
```

- [ ] **Step 2: Run Python unit tests**

```bash
cd python-service && .venv/bin/pytest tests/ -v --ignore=tests/smoke --ignore=tests/speed
```

Expected: all PASSED.

- [ ] **Step 3: Run web unit tests**

```bash
cd web && pnpm test
```

Expected: all PASSED.

- [ ] **Step 4: Manual smoke — verify genre flows end to end**

1. Search for a track known to be on Beatport (e.g., "Oscar Mulero Collapse")
2. Wait ~5 seconds for background enrichment
3. Check the DB: `SELECT "seedGenre", "seedBpm" FROM "SearchQuery" ORDER BY "createdAt" DESC LIMIT 1;`
4. Confirm `seedGenre` is set to a bucket name (e.g., `"techno"`)
5. Trigger a train run via the admin UI
6. Check the new `ModelWeights` row has non-null `genreAdjustments`

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: integration fixups from smoke testing"
```
