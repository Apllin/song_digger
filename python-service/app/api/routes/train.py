import numpy as np
from fastapi import APIRouter, HTTPException
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.core.models import SampleFeatures, TrainingRequest, TrainingResult

router = APIRouter()

SOURCES = ["cosine_club", "youtube_music", "yandex_music", "lastfm", "trackidnet", "soundcloud", "lastfm_hop"]
RANK_DECAY_K = 60.0
MIN_SAMPLES = 20
# Soft cap for bpmDelta normalisation: covers ~half-tempo (±24 BPM) so the
# feature has dynamic range beyond the strict ±6 compatibility threshold.
BPM_DELTA_CAP = 24.0
BPM_COMPATIBLE_MAX = 6.0


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
    return [
        *source_features,
        f.cosineScore or 0.0,
        f.numSources / len(SOURCES),
        bpm_delta_norm,
        bpm_compatible,
        bpm_present,
        key_compatible,
        key_present,
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

    # StandardScaler normalises features so LR converges reliably regardless
    # of scale differences between the 1/(k+rank) features and cosineScore.
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = LogisticRegression(C=1.0, max_iter=1000, solver="lbfgs")
    model.fit(X_scaled, y)

    # Recover unscaled coefficients: β_raw = β_scaled / σ
    # These are in the original feature space, so source coefficients are
    # directly usable as multipliers in Σ sw / (k + rank).
    coef = model.coef_[0] / scaler.scale_

    source_weights = {
        source: float(np.clip(coef[i], 0.1, 10.0))
        for i, source in enumerate(SOURCES)
    }

    return TrainingResult(
        source_weights=source_weights,
        cosine_score_weight=float(coef[len(SOURCES)]),
        num_sources_weight=float(coef[len(SOURCES) + 1]),
        rank_decay_k=RANK_DECAY_K,
        sample_size=len(req.samples),
    )
