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
