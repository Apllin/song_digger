"""
nDCG@10 implementation for the track_digger eval harness.

Relevance grades:
    relevant      → rel = 2  (boost: result we want at the top)
    false_friend  → rel = 0  (penalty: surface-similar but stylistically off)
    unmarked      → rel = 1  (neutral: not labeled either way)

Why unmarked = 1 rather than 0:
    The eval set is finite (~30 seeds with ~10 labels each = 300 labeled
    tracks). Production results frequently include genuinely good tracks that
    haven't been labeled yet. Marking them as 0 punishes the system for
    finding good tracks just because the eval set hasn't caught up to them.
    Neutral=1 reads as "don't know, no penalty, no reward" — correct given
    label-set-incompleteness.

    Trade-off: you cannot get credit for finding unmarked relevant tracks.
    The fix is the extend-eval-set workflow: when reviewing run output you
    notice clearly-relevant tracks not in the labels, you add them.
"""
import math
from typing import Literal

GradeLabel = Literal["relevant", "false_friend", "unmarked"]

GRADE_TO_REL: dict[GradeLabel, int] = {
    "relevant": 2,
    "false_friend": 0,
    "unmarked": 1,
}


def dcg(grades: list[GradeLabel], k: int = 10) -> float:
    """Discounted Cumulative Gain at rank k.

    Formula: DCG@k = Σ_{i=1..k} (2^rel_i - 1) / log2(i + 1)
    """
    return sum(
        (2 ** GRADE_TO_REL[g] - 1) / math.log2(i + 2)  # i is 0-indexed; position is i+1, log2(i+2)
        for i, g in enumerate(grades[:k])
    )


def ideal_dcg(grades: list[GradeLabel], k: int = 10) -> float:
    """DCG of the ideal ordering (highest-relevance items first)."""
    by_priority = sorted(grades[:k], key=lambda g: -GRADE_TO_REL[g])
    return dcg(by_priority, k)


def ndcg_at_10(grades: list[GradeLabel]) -> float:
    """Normalized DCG at 10. Returns 0.0 when no positive relevance is achievable."""
    idcg = ideal_dcg(grades, k=10)
    if idcg == 0:
        return 0.0
    return dcg(grades, k=10) / idcg
