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
STRIP_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        _both_brackets(r"original mix"),
        _both_brackets(r"extended(?:\s+mix)?"),
        _both_brackets(r"radio\s+(?:edit|mix)"),
        _both_brackets(r"(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)"),
        _both_brackets(r"(?:feat\.|ft\.|featuring)\s+[^\)\]]*"),
        _both_brackets(r"(?:prod\.|produced\s+by)\s+[^\)\]]*"),
        _both_brackets(r"(?:clean|explicit)"),
        _both_brackets(r"bonus\s+track"),
    )
)


def strip_recording_suffixes(s: str) -> str:
    """Remove whitelisted same-recording suffixes; preserves version markers."""
    for pat in STRIP_PATTERNS:
        s = pat.sub("", s)
    return s
