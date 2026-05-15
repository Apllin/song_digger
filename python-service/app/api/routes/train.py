import numpy as np
from fastapi import APIRouter, HTTPException
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.core.models import SampleFeatures, TrainingRequest, TrainingResult

router = APIRouter()

SOURCES = ["cosine_club", "youtube_music", "yandex_music", "lastfm", "trackidnet", "soundcloud"]
RANK_DECAY_K = 60.0
MIN_SAMPLES = 20


def _build_feature_vector(f: SampleFeatures) -> list[float]:
    source_ranks = {a.source: a.rank for a in f.appearances}
    source_features = [
        1.0 / (RANK_DECAY_K + source_ranks[s]) if s in source_ranks else 0.0
        for s in SOURCES
    ]
    return [
        *source_features,
        f.cosineScore or 0.0,
        f.numSources / len(SOURCES),
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
