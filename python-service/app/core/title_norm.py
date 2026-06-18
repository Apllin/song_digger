"""Shared title normalisation for the similarity pipeline.

Two layers, both whitelist-only — unknown text is always kept, because a stray
tag left in is cheaper than losing part of a real title:

- `strip_recording_suffixes`: same-recording suffixes (Original Mix, Remaster,
  feat., …) plus catalogue tags. Handles two surface forms — bracketed
  ("Track (Original Mix)") and trailing-hyphen ("Track - Original Mix") — because
  Last.fm/Discogs emit the latter while Cosine/YTM/Yandex bracket them. Used by
  `app.adapters._seed_match` seed signatures and the SoundCloud parser. Mirrored
  in web/lib/aggregator.ts:normalizeTitle — keep in sync or alternate versions
  like "(NK & David Löhlein Version)" collapse onto the original seed.

- `clean_title`: display-facing cleanup (TRA-27). Everything the normaliser
  strips, plus source *service* tags — promo banners ([PREMIERE], FREE DL),
  vinyl positions (A1, [B2]), label tails (| Tresor) and quality markers
  ([HD]) — with original case preserved. Applied to every source's titles in
  the /similar route.

Version markers (Remix, Dub, Live, VIP, Edit, Instrumental, …) identify a
distinct recording and are never stripped.
"""

import re


def _both_brackets(inner: str) -> str:
    """Wrap an inner pattern so it matches either ( ... ) or [ ... ]."""
    return rf"\s*(?:\({inner}\)|\[{inner}\])"


def _trailing_hyphen(inner: str) -> str:
    # Spotify/Apple/Yandex style: " - Original Mix" anchored to end of string.
    return rf"\s+[-–—]\s+{inner}\s*$"


# Version keywords that mark a DISTINCT recording. Used as a negative guard so
# the catalogue matcher can't eat a versioned bracket like "[Live 2020]".
_VERSION_WORDS = (
    r"remix|rmx|mix|dub|live|edit|vip|version|instrumental|acapella|acappella|"
    r"rework|bootleg|reprise|interlude|intro|outro|flip|refix"
)

# Suffixes describing the SAME recording — safe to drop. Both Last.fm/Discogs
# raw scrobble names ("Track - Original Mix") and bracketed catalog forms
# ("Track (Original Mix)") must be handled or orphans accumulate when fusing.
_SAME_RECORDING_INNER = (
    r"original mix",
    r"extended(?:\s+mix)?",
    r"radio\s+(?:edit|mix)",
    r"(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)",
)

# Catalogue/label tags in square brackets — the defining mark is a catalogue
# NUMBER: an alpha label code fused with or joined to >=2 digits. Covers
# "[Perlon114]", "[Perlon 114]", "[DRUM-01]", "[Perlon - PERL114]",
# "[Soft Evidences / SOFT03]", "[SOMOV010]". The negative guard keeps versioned
# brackets ("[Live 2020]") intact; the >=2-digit floor keeps "[Part 2]" intact.
_CATALOG_TAG: re.Pattern[str] = re.compile(
    r"\s*\[(?![^\]]*\b(?:" + _VERSION_WORDS + r")\b)"
    r"[^\]]*?[A-Za-z]{2,}[\s–/-]{0,3}\d{2,}[^\]]*\]",
    re.IGNORECASE,
)

STRIP_PATTERNS: tuple[re.Pattern[str], ...] = (
    *(
        re.compile(p, re.IGNORECASE)
        for p in (
            *(_both_brackets(inner) for inner in _SAME_RECORDING_INNER),
            _both_brackets(r"(?:feat\.|ft\.|featuring)\s+[^\)\]]*"),
            _both_brackets(r"(?:prod\.|produced\s+by)\s+[^\)\]]*"),
            _both_brackets(r"(?:clean|explicit)"),
            _both_brackets(r"bonus\s+track"),
            *(_trailing_hyphen(inner) for inner in _SAME_RECORDING_INNER),
            # Bare feat./ft./featuring without brackets — always trailing.
            r"\s+(?:feat\.|ft\.|featuring)\s+.*$",
        )
    ),
    _CATALOG_TAG,
)


def strip_recording_suffixes(s: str) -> str:
    """Remove whitelisted same-recording suffixes + catalogue tags; preserves
    version markers. Case-insensitive, so callers may pass any case."""
    for pat in STRIP_PATTERNS:
        s = pat.sub("", s)
    # Collapse whitespace left behind by mid-string strips.
    return re.sub(r"\s+", " ", s).strip()


# ── Display-only service tags (TRA-27) ───────────────────────────────────────
# Source banners that aren't part of the title. Whitelist-only; applied by
# clean_title with original case preserved.

_PROMO_WORDS = (
    r"premiere|exclusive|free\s+(?:download|dl)|free\s*dl|out\s+now|official|"
    r"forthcoming|unreleased|promo|teaser|snippet|preview"
)

_SERVICE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Promo prefix: "PREMIERE: …", "PREMIERE | …", "[FREE DL] …"
    re.compile(
        rf"^(?:\[(?:{_PROMO_WORDS})\]\s*|(?:{_PROMO_WORDS})\s*[:|]\s*)",
        re.IGNORECASE,
    ),
    # Promo tag in brackets/parens anywhere: "[PREMIERE]", "(Free Download)"
    re.compile(rf"\s*[\[(](?:{_PROMO_WORDS})[)\]]", re.IGNORECASE),
    # Label-name suffix: "[Divinity Records]", "[Tresor Music]"
    re.compile(
        r"\s*\[[^\]]*\b(?:records?|recordings?|music|label|ltd)\]\s*$",
        re.IGNORECASE,
    ),
    # Leading vinyl position: "A1 ", "C2. ", "D3: " (side A–D + track no.)
    re.compile(r"^[A-D][0-9]{1,2}[.):]?\s+(?=\S)"),
    # Bracketed vinyl position: "[A2]", "(B1)"
    re.compile(r"\s*[\[(][A-D][0-9]{1,2}[)\]]"),
    # Quality markers in brackets: "[HD]", "(FULL)", "[HQ]"
    re.compile(r"\s*[\[(](?:hd|hq|full(?:\s+version)?|master)[)\]]", re.IGNORECASE),
    # Pipe / double-slash label tail: "Title | Label", "Title // Free DL"
    re.compile(r"\s*(?:\|+|//).*$"),
)


def clean_title(s: str) -> str:
    """Display-facing title cleanup (TRA-27).

    Strips same-recording suffixes, catalogue tags, and source service banners
    (promo, vinyl positions, label tails, quality markers), preserving case and
    version markers. Whitelist-only. Returns the trimmed result; callers should
    fall back to the original if this comes back empty (title was all tags).
    """
    out = strip_recording_suffixes(s)
    for pat in _SERVICE_PATTERNS:
        out = pat.sub("", out)
    out = re.sub(r"\s{2,}", " ", out)
    return out.strip(" -–|/").strip()
