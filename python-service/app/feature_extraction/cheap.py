"""
Cheap feature extraction — runs synchronously during search persistence.

No external API calls, no DB queries. Pure function from inputs to feature
dict so it stays trivially testable and adds no latency-relevant variance
to the search response. See ADR-0011 for the schema rationale.
"""
from typing import Optional


def _key_compatibility(key_a: Optional[str], key_b: Optional[str]) -> Optional[float]:
    """
    Camelot key compatibility quantized to {1.0, 0.7, 0.0}.

    The Camelot wheel has 12 hours × 2 modes (A=minor, B=major). The classic
    "harmonic mixing" rules treat as compatible: same key, ±1 hour same mode,
    and relative major/minor (same hour, opposite mode). Everything else is
    discordant.

      ("8A", "8A") → 1.0  same key
      ("8A", "9A") → 0.7  one step on the wheel, same mode
      ("8A", "7A") → 0.7  one step on the wheel, same mode
      ("12A","1A") → 0.7  wheel wrap counts as one step
      ("8A", "8B") → 0.7  relative major/minor
      ("8A", "5B") → 0.0  no harmonic relationship

    Returns None when either input is missing or unparseable; the column
    distinguishes "no Camelot data" from "data present and discordant".
    """
    if not key_a or not key_b:
        return None
    try:
        a_num = int(key_a[:-1])
        a_mode = key_a[-1]
        b_num = int(key_b[:-1])
        b_mode = key_b[-1]
    except (ValueError, IndexError):
        return None
    if a_mode not in ("A", "B") or b_mode not in ("A", "B"):
        return None
    if not (1 <= a_num <= 12 and 1 <= b_num <= 12):
        return None

    if a_num == b_num and a_mode == b_mode:
        return 1.0
    diff = min(abs(a_num - b_num), 12 - abs(a_num - b_num))
    if a_mode == b_mode and diff == 1:
        return 0.7
    if a_num == b_num and a_mode != b_mode:
        return 0.7
    return 0.0


def extract_cheap_features(
    *,
    candidate: dict,
    seed_bpm: Optional[float],
    seed_key: Optional[str],
    seed_energy: Optional[float],
    seed_label: Optional[str],
    seed_genre: Optional[str],
    n_sources: int,
    top_rank: int,
    rrf_score: float,
) -> dict:
    """
    Compute the C1 feature dict for a single candidate.

    Numerical features that depend on missing metadata return None — the
    schema (ADR-0011) treats null and zero as different signals because the
    downstream Stage D model handles missingness explicitly. Structural
    features (n_sources, top_rank, has_embed, rrf_score) are always defined.
    """
    bpm_delta = (
        abs(candidate["bpm"] - seed_bpm)
        if candidate.get("bpm") is not None and seed_bpm is not None
        else None
    )

    energy_delta = (
        abs(candidate["energy"] - seed_energy)
        if candidate.get("energy") is not None and seed_energy is not None
        else None
    )

    key_compat = _key_compatibility(candidate.get("key"), seed_key)

    label_match: Optional[float] = None
    if candidate.get("label") and seed_label:
        label_match = (
            1.0
            if candidate["label"].strip().lower() == seed_label.strip().lower()
            else 0.0
        )

    genre_match: Optional[float] = None
    if candidate.get("genre") and seed_genre:
        genre_match = (
            1.0
            if candidate["genre"].strip().lower() == seed_genre.strip().lower()
            else 0.0
        )

    has_embed = 1 if candidate.get("embedUrl") else 0

    return {
        "bpmDelta": bpm_delta,
        "keyCompat": key_compat,
        "energyDelta": energy_delta,
        "labelMatch": label_match,
        "genreMatch": genre_match,
        "nSources": n_sources,
        "topRank": top_rank,
        "hasEmbed": has_embed,
        "rrfScore": rrf_score,
    }
