"""Discogs-style → MusicBrainz/ListenBrainz tag mapping and lb-radio prompt
builder for the Troi adapter (TRA-28).

Troi's `tag` element is documented as in-flux, so all tag logic is isolated
here behind the mapping table — the adapter never hard-codes a tag string.
The mapping is intentionally not 1:1: Discogs styles are finer-grained and
differently named than the crowd tags ListenBrainz indexes, so several styles
collapse onto the same MB tag and some have no usable MB equivalent (omitted).
"""

# Discogs style (lower-cased) → MB/LB crowd tags. Curated for the techno-
# adjacent long tail Track Digger targets; extend as new styles show up.
DISCOGS_STYLE_TO_MB_TAGS: dict[str, list[str]] = {
    "techno": ["techno"],
    "minimal techno": ["minimal techno", "techno"],
    "hypnotic techno": ["hypnotic techno", "techno"],
    "dub techno": ["dub techno", "techno"],
    "industrial techno": ["industrial techno", "industrial", "techno"],
    "hard techno": ["hard techno", "techno"],
    "detroit techno": ["detroit techno", "techno"],
    "acid": ["acid", "acid techno"],
    "acid techno": ["acid techno", "acid"],
    "ambient techno": ["ambient techno", "ambient"],
    "deep techno": ["deep techno", "techno"],
    "tech house": ["tech house", "house"],
    "deep house": ["deep house", "house"],
    "minimal": ["minimal"],
    "electro": ["electro"],
    "breakbeat": ["breakbeat"],
    "idm": ["idm"],
    "dub": ["dub"],
    "ambient": ["ambient"],
    "industrial": ["industrial"],
    "ebm": ["ebm"],
    "trip hop": ["trip hop"],
    "drum n bass": ["drum and bass"],
    "house": ["house"],
}

# dig_intensity (named) → Troi lb-radio mode. Numeric intensities (0.0–1.0)
# map by threshold so a single slider can drive the mode.
_NAMED_INTENSITY_TO_MODE = {
    "low": "easy",
    "familiar": "easy",
    "easy": "easy",
    "medium": "medium",
    "balanced": "medium",
    "high": "hard",
    "obscure": "hard",
    "hard": "hard",
}

MAX_TAGS = 4  # keep the prompt focused; too many tags dilutes the seed


def dig_intensity_to_mode(dig_intensity: str | float) -> str:
    """Map a dig-intensity (named string or 0.0–1.0 float) to a Troi mode.
    Higher intensity → harder mode → deeper into the long tail. Unknown
    values fall back to 'medium'."""
    if isinstance(dig_intensity, (int, float)):
        if dig_intensity >= 0.66:
            return "hard"
        if dig_intensity >= 0.33:
            return "medium"
        return "easy"
    return _NAMED_INTENSITY_TO_MODE.get(dig_intensity.strip().lower(), "medium")


def styles_to_tags(discogs_styles: list[str]) -> list[str]:
    """Map a seed's Discogs styles to deduped MB/LB tags, order-preserving.
    Unmapped styles are dropped. Capped at MAX_TAGS."""
    tags: list[str] = []
    seen: set[str] = set()
    for style in discogs_styles:
        for tag in DISCOGS_STYLE_TO_MB_TAGS.get(style.strip().lower(), []):
            if tag not in seen:
                seen.add(tag)
                tags.append(tag)
    return tags[:MAX_TAGS]


def _sanitize(term: str) -> str:
    """Strip characters that would break the lb-radio prompt grammar
    (parentheses and colons delimit elements)."""
    return term.replace("(", " ").replace(")", " ").replace(":", " ").strip()


def build_lb_radio_prompt(
    seed_artist: str,
    discogs_styles: list[str] | None = None,
    dig_intensity: str | float = "medium",
) -> tuple[str, str]:
    """Build an (lb_radio_prompt, mode) pair from a seed.

    Composes an `artist:(…)` term (Troi resolves CF-similar artists natively)
    with a `tag:(…)` term derived from the seed's Discogs styles. Either term
    can carry the result if the other comes up empty — a deliberate hedge
    against Troi's artist/tag datasets failing independently. Returns ("", mode)
    when there is no usable seed signal at all; the adapter treats that as a
    no-op rather than running an unseeded query."""
    mode = dig_intensity_to_mode(dig_intensity)
    parts: list[str] = []

    artist = _sanitize(seed_artist or "")
    if artist:
        parts.append(f"artist:({artist})")

    tags = styles_to_tags(discogs_styles or [])
    if tags:
        joined = ", ".join(_sanitize(t) for t in tags if _sanitize(t))
        if joined:
            parts.append(f"tag:({joined})")

    return " ".join(parts), mode
