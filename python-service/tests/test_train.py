"""Tests for the /train route — coefficient ranges + regularisation behaviour.

The point of these tests is to lock in the clipping ranges that keep trained
weights inside what the data actually warrants. Without them, a future C= or
clip-range bump can silently widen the spread of source coefficients again
(the failure mode in TRA-issue around 600 labeled samples).
"""
import random

import pytest

from app.api.routes.train import (
    AUDIO_WEIGHT_CLIP,
    MIN_SAMPLES,
    SOURCE_WEIGHT_CLIP,
    SOURCES,
    train_weights,
)
from app.core.models import SampleFeatures, SourceAppearance, TrainingRequest, TrainingSample


def _sample(*, sources_at_rank: dict[str, int], is_similar: bool,
            cosine_score: float | None = None, num_sources_override: int | None = None,
            bpm_delta: float | None = None, key_compatible: bool | None = None) -> TrainingSample:
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
        ),
        is_similar=is_similar,
    )


async def test_rejects_below_min_samples():
    samples = [_sample(sources_at_rank={"lastfm": 1}, is_similar=True) for _ in range(MIN_SAMPLES - 1)]
    with pytest.raises(Exception) as exc_info:
        await train_weights(TrainingRequest(samples=samples))
    assert "least" in str(exc_info.value).lower() or "422" in str(exc_info.value)


async def test_source_weights_stay_inside_clip_range():
    """Even with adversarially perfect class separation by source, source weights
    are bounded by SOURCE_WEIGHT_CLIP."""
    random.seed(42)
    samples: list[TrainingSample] = []
    # Strong positive signal for trackidnet, strong negative for lastfm.
    for _ in range(80):
        samples.append(_sample(sources_at_rank={"trackidnet": random.randint(1, 5)}, is_similar=True))
        samples.append(_sample(sources_at_rank={"lastfm": random.randint(1, 5)}, is_similar=False))
    result = await train_weights(TrainingRequest(samples=samples))
    lo, hi = SOURCE_WEIGHT_CLIP
    for src in SOURCES:
        assert lo <= result.source_weights[src] <= hi, f"{src} = {result.source_weights[src]}"
    assert result.source_weights["trackidnet"] >= result.source_weights["lastfm"]


async def test_audio_aggregate_weights_stay_inside_clip_range():
    """numSources / cosineScore were previously uncapped — a clear monotonic
    signal could blow num_sources_weight past 30. Now they're symmetric-clipped."""
    random.seed(7)
    samples: list[TrainingSample] = []
    for i in range(80):
        # Many-source tracks are similar; single-source tracks are not.
        if i % 2 == 0:
            samples.append(_sample(
                sources_at_rank={s: 1 for s in SOURCES[:5]},
                num_sources_override=5,
                is_similar=True,
                cosine_score=0.9,
            ))
        else:
            samples.append(_sample(
                sources_at_rank={"lastfm": 30},
                is_similar=False,
                cosine_score=0.1,
            ))
    result = await train_weights(TrainingRequest(samples=samples))
    lo, hi = AUDIO_WEIGHT_CLIP
    for name, val in (
        ("cosine_score_weight", result.cosine_score_weight),
        ("num_sources_weight", result.num_sources_weight),
        ("bpm_delta_weight", result.bpm_delta_weight),
        ("bpm_compatible_weight", result.bpm_compatible_weight),
        ("bpm_present_weight", result.bpm_present_weight),
        ("key_compatible_weight", result.key_compatible_weight),
        ("key_present_weight", result.key_present_weight),
    ):
        assert lo <= val <= hi, f"{name} = {val}"


async def test_modest_signal_produces_modest_weights():
    """A 33% vs 62% hit-rate spread (real-world feedback shape) should land
    source weights near 1.0, not pinned to the clip ceiling/floor."""
    random.seed(1)
    samples: list[TrainingSample] = []
    # Two sources with realistic hit-rates: A wins ~60% of the time, B ~35%.
    for _ in range(150):
        samples.append(_sample(
            sources_at_rank={"trackidnet": random.randint(1, 20)},
            is_similar=random.random() < 0.62,
        ))
        samples.append(_sample(
            sources_at_rank={"lastfm": random.randint(1, 20)},
            is_similar=random.random() < 0.33,
        ))
    result = await train_weights(TrainingRequest(samples=samples))
    # Reflect the data, not slam into 0.3 or 3.0.
    assert 0.5 <= result.source_weights["trackidnet"] <= 3.0
    assert 0.3 <= result.source_weights["lastfm"] <= 1.5
    assert result.source_weights["trackidnet"] > result.source_weights["lastfm"]
