"""Genre bucketing and one-hot encoding for model conditioning."""

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
    """Map raw genre string to one of 7 buckets."""
    if genre is None:
        return "other"
    return GENRE_MAP.get(genre, "other")


def genre_one_hot(bucket: str) -> list[float]:
    """Convert bucket name to one-hot encoded vector."""
    return [1.0 if b == bucket else 0.0 for b in GENRE_BUCKETS]


def bpm_range_features(seed_bpm: float | None) -> tuple[list[float], float]:
    """Convert BPM to one-hot range encoding + presence flag.

    Returns:
        (bpm_range_one_hot, present_flag): one-hot vector of length 4 (slow/mid/fast/vfast),
        and a binary flag (1.0 if BPM provided, 0.0 if None).
    """
    if seed_bpm is None:
        return [0.0] * len(BPM_RANGES), 0.0
    if seed_bpm < 90:
        idx = 0  # slow
    elif seed_bpm < 120:
        idx = 1  # mid
    elif seed_bpm < 140:
        idx = 2  # fast
    else:
        idx = 3  # vfast
    one_hot = [1.0 if i == idx else 0.0 for i in range(len(BPM_RANGES))]
    return one_hot, 1.0
