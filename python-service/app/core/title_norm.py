"""Shared title normalisation for the similarity pipeline.

Two consumers must agree on which parenthetical suffixes describe the *same*
recording (safe to drop) versus a *distinct* version (must survive):

- `app.adapters._seed_match`: validates upstream search hits as plausible seeds.
- `app.api.routes.similar`: dedupes titles when fusing per-source ranked lists.

When these two drift, alternate versions like "(NK & David Löhlein Version)"
collapse onto the original seed in fuzzy upstream search and silently merge
their similar-track lists with the original.
"""

import re


def _both_brackets(inner: str) -> str:
    """Wrap an inner pattern so it matches either ( ... ) or [ ... ]."""
    return rf"\s*(?:\({inner}\)|\[{inner}\])"


# Suffixes describing the SAME recording — safe to drop. Anything not listed
# (Remix, Dub, Live, VIP, Acoustic, Instrumental, Edit, Version, …) identifies
# a distinct recording and must survive.
#
# Two surface forms must be handled because Last.fm/Discogs return raw
# scrobble names ("Track - Original Mix") while Cosine/YTM/Yandex catalogs
# often bracket them ("Track (Original Mix)"). Without the hyphen form,
# orphans accumulate on the tail of fused results.
_SAME_RECORDING_INNER = (
    r"original mix",
    r"extended(?:\s+mix)?",
    r"radio\s+(?:edit|mix)",
    r"(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)",
)


def _trailing_hyphen(inner: str) -> str:
    # Spotify/Apple/Yandex style: " - Original Mix" anchored to end of string.
    return rf"\s+[-–—]\s+{inner}\s*$"


STRIP_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        *(_both_brackets(inner) for inner in _SAME_RECORDING_INNER),
        _both_brackets(r"(?:feat\.|ft\.|featuring)\s+[^\)\]]*"),
        _both_brackets(r"(?:prod\.|produced\s+by)\s+[^\)\]]*"),
        _both_brackets(r"(?:clean|explicit)"),
        _both_brackets(r"bonus\s+track"),
        *(_trailing_hyphen(inner) for inner in _SAME_RECORDING_INNER),
        # Bare feat./ft./featuring without brackets — always trailing in practice.
        r"\s+(?:feat\.|ft\.|featuring)\s+.*$",
    )
)


def strip_recording_suffixes(s: str) -> str:
    """Remove whitelisted same-recording suffixes; preserves version markers."""
    for pat in STRIP_PATTERNS:
        s = pat.sub("", s)
    # Collapse whitespace left behind by mid-string strips.
    return re.sub(r"\s+", " ", s).strip()
