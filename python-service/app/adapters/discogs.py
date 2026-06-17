import asyncio
import re
import unicodedata
import httpx
from app.config import settings
from app.core.db import fetch_external_cache, upsert_external_cache
from app.core.models import TrackMeta
from app.services.discogs_warm import request_warm

BASE_URL = "https://api.discogs.com"
WWW_URL = "https://www.discogs.com"

# Collaborative-filtering source: people who Have/Want the seed → what else is
# in their collection, filtered to the seed's Discogs styles. Owners can only
# be read off the Cloudflare-protected www stats page, so the build is offline
# (scripts/warm_discogs_similar.py) and find_similar serves the warmed cache.
_COLLAB_MAX_USERS = 3            # collectors sampled per seed (Have first, top up from Want)
_COLLAB_TRACKS_PER_USER = 3      # max releases taken from one collector
_COLLAB_OUTPUT_LIMIT = 9         # _COLLAB_MAX_USERS * _COLLAB_TRACKS_PER_USER
_COLLAB_CANDIDATE_CAP = 9        # bound over-fetch when collectors are private/empty/off-genre
_COLLAB_TTL = 30 * 86400

# Style families: members are one symmetric cluster — they match each other in
# both directions. Styles not listed match only themselves. Lowercased.
STYLE_FAMILIES: list[set[str]] = [
    {"acid", "acid house"},
    {"deep house", "house", "tech house"},
    {"dub", "dub techno"},
    {"electro", "electro house"},
    {"ambient", "drone"},
    {"disco", "euro-disco"},
    {"trance", "progressive trance", "psy-trance"},
    {"happy hardcore", "hard house", "hard techno", "hard trance", "hardcore",
     "hardstyle", "jumpstyle", "schranz", "gabber", "industrial"},
]
# style → stable family key (alphabetically-first member); unlisted → itself.
_STYLE_TO_FAMILY: dict[str, str] = {
    style: f"fam:{min(family)}" for family in STYLE_FAMILIES for style in family
}


def _fam(style: str) -> str:
    """Canonical family key for a style (or the style itself when unlisted)."""
    return _STYLE_TO_FAMILY.get(style, style)


# Directional broadening (one-way): a SEED whose style is in the key family also
# matches candidates in the listed broader families — but NOT the reverse, since
# the targets are more abstract umbrellas. e.g. a House seed matches Techno
# candidates; a Techno seed does not match House. Keyed by family key.
STYLE_BROADENS: dict[str, set[str]] = {
    _fam("house"): {_fam("techno")},                              # House (incl. Tech House) → Techno
    _fam("minimal techno"): {_fam("techno")},                     # Minimal Techno → Techno
    _fam("minimal"): {_fam("minimal techno"), _fam("techno")},    # Minimal → Minimal Techno, Techno
}

# The stats page renders three `release_stats_group` blocks (Ratings, Have,
# Want), each an <h2> heading + a <ul> of collectors. The group div is
# class="release_stats_group" — the inner list is "..._list", so this exact
# marker splits on groups only. Usernames sit in <span class="linked_username">.
_GROUP_MARKER = 'class="release_stats_group"'
_H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
_USERNAME_RE = re.compile(r'class="linked_username">([^<]+)</span>')
# Heading keywords are localized; match the buckets we care about across RU/EN
# (Ratings and any other group fall through and are ignored).
_WANT_MARKERS = ("желаем", "want")
_HAVE_MARKERS = ("есть у", "have", "коллекци", "collection")

# Discogs is a community-edited DB (Wikipedia-style). Tracklists/metadata get
# corrected after publish — most edits land in the first weeks. 30d catches
# those, 6mo for tracklists which are even more identity-stable once a release
# has been around. None of these calls feed /api/search ranking (Discogs is
# scoped to /discography + /labels per ADR-0019), so caching is risk-free for
# search quality.
_TTL_30D = 30 * 86400
_TTL_6MO = 180 * 86400


def _normalize_query(q: str) -> str:
    return " ".join(q.lower().split())


def _normalize_text(s: str) -> str:
    """NFKD-decompose, drop combining marks, lowercase, collapse whitespace.
    Used as the dedup key in `_dedupe_by_title_artist` so 'Nørbak' and
    'Norbak' collapse, and spacing variants don't fragment groups."""
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return " ".join(stripped.lower().split())


def _year_rank(r: dict) -> tuple[int, int]:
    """Tie-break key for dedup: (year_is_missing_flag, year).
    A real year sorts before None; among real years, smaller wins.
    Records with the same key fall through to first-seen-wins."""
    y = r.get("year")
    if y is None:
        return (1, 0)
    return (0, int(y))


def _dedupe_by_title_artist(releases: list[dict]) -> list[dict]:
    """
    Collapse format/quality variants of the same album into one entry.

    Discogs assigns a separate release ID to every format-or-quality variant
    of an album — vinyl, MP3 320, FLAC 16-bit, FLAC 24-bit each get their
    own row in the label catalog. The label page wants an album-level view:
    one entry per (artist, title), with the **earliest release year** as the
    canonical representative (digital pre-releases usually predate the
    physical drop, so this naturally surfaces the album's first appearance).

    Records with a missing/empty artist or title bypass grouping — there's
    no key to merge them on, so they pass through as standalone entries.

    Tie-break (same year on multiple variants) is first-seen-wins, which
    follows Discogs's natural pagination order. We don't try to prefer
    vinyl over digital — that's a different product decision, see ADR.
    """
    groups: dict[tuple[str, str], dict] = {}
    ungrouped: list[dict] = []
    for r in releases:
        title = r.get("title") or ""
        artist = r.get("artist") or ""
        title_key = _normalize_text(title)
        artist_key = _normalize_text(artist)
        if not title_key or not artist_key:
            ungrouped.append(r)
            continue
        key = (artist_key, title_key)
        existing = groups.get(key)
        if existing is None or _year_rank(r) < _year_rank(existing):
            groups[key] = r
    return list(groups.values()) + ungrouped


def _split_query(query: str) -> tuple[str, str]:
    """The /similar route passes "Artist - Track"; artist-only mode passes the
    bare artist. Returns (artist, track) with track="" when no track is given."""
    if " - " in query:
        artist, _, track = query.partition(" - ")
        return artist.strip(), track.strip()
    return query.strip(), ""


def _parse_stats_usernames(html: str) -> dict[str, list[str]]:
    """Extract Have/Want collector usernames from a release stats page.

    Classifies each `release_stats_group` block by its <h2> heading and pulls
    usernames from the `linked_username` spans, so the caller can prefer owners
    and top up from wanters. The Ratings group (and any unrecognized group) is
    skipped. Headings are localized — see `_WANT_MARKERS` / `_HAVE_MARKERS`.

    Note: the page only renders a preview per group (e.g. "Не показано еще 8"),
    which is plenty for the few collectors we sample but is NOT the full list."""
    have: list[str] = []
    want: list[str] = []
    for chunk in html.split(_GROUP_MARKER)[1:]:
        h2 = _H2_RE.search(chunk)
        heading = (h2.group(1) if h2 else "").lower()
        if any(m in heading for m in _WANT_MARKERS):
            bucket = want
        elif any(m in heading for m in _HAVE_MARKERS):
            bucket = have
        else:
            continue  # Ratings / other groups carry no owner signal
        for m in _USERNAME_RE.finditer(chunk):
            name = m.group(1).strip()
            if name and name not in bucket:
                bucket.append(name)
    return {"have": have, "want": want}


def _style_families(styles: set[str]) -> set[str]:
    """Collapse styles to their family key so related styles share one bucket.
    Input must be lowercased; unlisted styles map to themselves."""
    return {_fam(s) for s in styles}


def _seed_match_targets(seed_styles: set[str]) -> set[str]:
    """Family keys a seed matches: its own families plus their one-way
    broadenings (e.g. a House seed also reaches Techno). See STYLE_BROADENS."""
    fams = _style_families(seed_styles)
    targets = set(fams)
    for f in fams:
        targets |= STYLE_BROADENS.get(f, set())
    return targets


def _track_from_collection_item(basic: dict) -> TrackMeta | None:
    """Map a collection release's `basic_information` block to a TrackMeta.
    Returns None when the release has no id (no stable sourceUrl)."""
    rid = basic.get("id")
    if not rid:
        return None
    artists = ", ".join(
        a.get("name", "").strip() for a in basic.get("artists", []) if a.get("name")
    )
    labels = basic.get("labels") or []
    styles = basic.get("styles") or []
    genres = basic.get("genres") or []
    return TrackMeta(
        title=basic.get("title") or "Unknown",
        artist=artists or "Unknown",
        source="discogs",
        sourceUrl=f"{WWW_URL}/release/{rid}",
        coverUrl=basic.get("cover_image") or basic.get("thumb") or None,
        genre=(styles[0] if styles else (genres[0] if genres else None)),
        label=(labels[0].get("name") if labels else None),
    )


class DiscogsAdapter:
    """
    Fetches artist discography (releases + tracklists) via Discogs REST API.
    Docs: https://www.discogs.com/developers/
    Rate limit: 60 req/min (authenticated).

    Uses a persistent httpx client so multiple paginated requests share one
    TCP connection instead of reopening it for every call.
    Retries automatically on 429 Rate-Limit (up to 3 attempts, honours Retry-After).

    Soft-degrades when DISCOGS_TOKEN is missing: every public method returns
    an empty result instead of firing a guaranteed-401 request.
    """

    def __init__(self) -> None:
        headers = {"User-Agent": "TrackDigger/1.0"}
        if settings.discogs_token:
            headers["Authorization"] = f"Discogs token={settings.discogs_token}"
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers=headers,
            timeout=20.0,
        )
        # Separate client for the www stats page (different host, no Discogs
        # auth header) — routed through an unblocker since www is Cloudflare-gated.
        self._stats_client = httpx.AsyncClient(
            headers={"User-Agent": "TrackDigger/1.0"},
            timeout=30.0,
            follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._client.aclose()
        await self._stats_client.aclose()

    async def _get(self, path: str, **kwargs) -> httpx.Response:
        """GET with automatic retry on 429 and transient 5xx (up to 3 attempts)."""
        for attempt in range(3):
            resp = await self._client.get(path, **kwargs)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(min(retry_after, 10))
                continue
            if resp.status_code >= 500 and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            resp.raise_for_status()
            return resp
        resp.raise_for_status()
        return resp  # unreachable; satisfies type checker

    async def search_artist(self, query: str, limit: int = 10) -> list[dict]:
        """Search for artists by name."""
        if not settings.discogs_token:
            return []
        cache_key = f"{_normalize_query(query)}|{limit}"
        cached = await fetch_external_cache(
            source="discogs_search_artist",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached
        resp = await self._get(
            "/database/search",
            params={"q": query, "type": "artist", "per_page": limit},
        )
        results = resp.json().get("results", [])
        out = [
            {
                "id": r.get("id"),
                "name": r.get("title"),
                "imageUrl": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in results
            if r.get("id")
        ]
        await upsert_external_cache(
            source="discogs_search_artist",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def get_releases(self, artist_id: int, role: str | None = None) -> dict:
        """
        Full discography for an artist, sorted by year desc and (optionally)
        filtered by role.

        Discogs paginates artist releases server-side but groups by `role`
        first, then sorts within each group — so `page=N` slices a role-group
        boundary, not a chronological one. To return a globally chronological
        list we have to pull every page, dedupe by id (Discogs lists the same
        release multiple times across roles like Producer / Appearance /
        TrackAppearance), apply the role filter on our side, and sort.

        `role=Main` keeps only the artist's own releases. Anything else is
        returned as-is.

        Returns: { releases, pagination: { page: 1, pages: 1, per_page, items } }.
        The pagination block is kept for response-shape stability; the
        consumer paginates client-side.
        """
        if not settings.discogs_token:
            return {"releases": [], "pagination": {"page": 1, "pages": 1, "per_page": 0, "items": 0}}
        # v2: payload gained the per-release `artist` field — old entries lack it.
        cache_key = f"v2|{artist_id}|{role or ''}"
        cached = await fetch_external_cache(
            source="discogs_artist_releases",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached

        per_page = 100
        first = await self._get(
            f"/artists/{artist_id}/releases",
            params={"sort": "year", "sort_order": "desc", "page": 1, "per_page": per_page},
        )
        first_data = first.json()
        total_pages = int(first_data.get("pagination", {}).get("pages", 1))

        raw: list[dict] = list(first_data.get("releases", []))
        if total_pages > 1:
            rest = await asyncio.gather(
                *(
                    self._get(
                        f"/artists/{artist_id}/releases",
                        params={"sort": "year", "sort_order": "desc", "page": p, "per_page": per_page},
                    )
                    for p in range(2, total_pages + 1)
                )
            )
            for r in rest:
                raw.extend(r.json().get("releases", []))

        seen: set[int] = set()
        deduped: list[dict] = []
        for r in raw:
            rid = r.get("id")
            if rid is None or rid in seen:
                continue
            seen.add(rid)
            deduped.append(r)

        if role:
            deduped = [r for r in deduped if r.get("role") == role]

        deduped.sort(key=lambda r: (r.get("year") is None, -(r.get("year") or 0)))

        releases = [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "artist": r.get("artist"),
                "year": r.get("year"),
                "type": r.get("type"),
                "role": r.get("role"),
                "format": r.get("format"),
                "label": r.get("label"),
                "thumb": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in deduped
        ]
        out = {
            "releases": releases,
            "pagination": {"page": 1, "pages": 1, "per_page": len(releases), "items": len(releases)},
        }
        await upsert_external_cache(
            source="discogs_artist_releases",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def search_label(self, query: str, limit: int = 10) -> list[dict]:
        """Search for labels by name."""
        if not settings.discogs_token:
            return []
        cache_key = f"{_normalize_query(query)}|{limit}"
        cached = await fetch_external_cache(
            source="discogs_search_label",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached
        resp = await self._get(
            "/database/search",
            params={"q": query, "type": "label", "per_page": limit},
        )
        results = resp.json().get("results", [])
        out = [
            {
                "id": r.get("id"),
                "name": r.get("title"),
                "imageUrl": r.get("thumb"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in results
            if r.get("id") and r.get("title")
        ]
        await upsert_external_cache(
            source="discogs_search_label",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def _get_label_page(self, label_id: int, page: int, per_page: int) -> dict:
        """
        Fetch a single Discogs page of label releases, mapping fields to our
        shape, with a per-page cache. Helper for `get_label_releases` which
        fans out across all pages on cold path.

        NB: Discogs's `/labels/{id}/releases` endpoint does NOT support
        `sort`/`sort_order` query params (verified against the official docs —
        only `page` and `per_page` are listed). Anything we'd pass for sort
        is silently dropped, so we don't pass it and instead sort the merged
        list in `get_label_releases` after gathering every page.
        """
        cache_key = f"{label_id}|{page}|{per_page}"
        cached = await fetch_external_cache(
            source="discogs_label_releases",
            cache_key=cache_key,
            ttl_seconds=_TTL_30D,
        )
        if cached is not None:
            return cached
        resp = await self._get(
            f"/labels/{label_id}/releases",
            params={"page": page, "per_page": per_page},
        )
        data = resp.json()
        releases = [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "year": r.get("year"),
                "artist": r.get("artist"),
                "format": r.get("format"),
                "catno": r.get("catno"),
                "thumb": r.get("thumb"),
                "type": r.get("type"),
                "resourceUrl": r.get("resource_url"),
            }
            for r in data.get("releases", [])
            if r.get("id")
        ]
        out = {
            "releases": releases,
            "pagination": data.get("pagination", {}),
        }
        await upsert_external_cache(
            source="discogs_label_releases",
            cache_key=cache_key,
            payload=out,
        )
        return out

    async def _fetch_all_label_pages(self, label_id: int, per_page: int = 100) -> list[dict]:
        """
        Fan out across every Discogs page for the label, parallel via
        asyncio.gather, dedup by release id, and return a flat list.

        Each page goes through the per-page cache (`_get_label_page`) so a
        repeated full-list rebuild after the sorted-list cache expires
        doesn't re-hit Discogs from scratch.
        """
        first = await self._get_label_page(label_id, 1, per_page)
        total_pages = int(first.get("pagination", {}).get("pages", 1) or 1)

        raw: list[dict] = list(first.get("releases", []))
        if total_pages > 1:
            rest = await asyncio.gather(
                *(self._get_label_page(label_id, p, per_page) for p in range(2, total_pages + 1))
            )
            for page_data in rest:
                raw.extend(page_data.get("releases", []))

        seen: set[int] = set()
        deduped: list[dict] = []
        for r in raw:
            rid = r.get("id")
            if rid is None or rid in seen:
                continue
            seen.add(rid)
            deduped.append(r)
        # Second pass: collapse format/quality variants of the same album.
        # Discogs lists vinyl / MP3 / FLAC-16bit / FLAC-24bit as separate ids
        # — `_dedupe_by_title_artist` keeps the earliest-year representative
        # per (artist, title) so the UI shows one row per album.
        return _dedupe_by_title_artist(deduped)

    async def get_label_releases(
        self, label_id: int, page: int = 1, per_page: int = 100
    ) -> dict:
        """
        Paginated label releases, sorted by year desc, with the FULL sorted
        list cached in `ExternalApiCache` and sliced per request.

        First call for a label: fan out across all Discogs pages, dedup,
        sort by year desc, store the full sorted list under
        `discogs_label_releases_sorted` (30d TTL), slice and return the
        requested page. Subsequent calls within the TTL slice from the same
        cached list — no Discogs round-trips needed at all.

        This replaces the previous design where each page request hit
        Discogs (cached per page, but `sort=year` was silently ignored —
        so the rows came back in Discogs's default order, not chronological).

        Returns: { releases, pagination: { page, pages, per_page, items } }
        """
        if not settings.discogs_token:
            return {
                "releases": [],
                "pagination": {"page": page, "pages": 0, "per_page": per_page, "items": 0},
            }

        sort_field = "year"
        sort_order = "desc"
        # Bump this when the dedup heuristic or response shape changes —
        # old cached payloads (pre-dedup) live for 30 days and we don't want
        # to serve them from the new code path. New version = new key space;
        # stale entries age out on their own TTL.
        dedup_version = "dedup-v1"
        full_cache_key = f"{label_id}|{sort_field}|{sort_order}|{dedup_version}"
        cached_full = await fetch_external_cache(
            source="discogs_label_releases_sorted",
            cache_key=full_cache_key,
            ttl_seconds=_TTL_30D,
        )

        if cached_full is None:
            all_releases = await self._fetch_all_label_pages(label_id, per_page=100)
            # year=None last, then year desc. Mirrors the artist sort tiebreaker.
            all_releases.sort(key=lambda r: (r.get("year") is None, -(r.get("year") or 0)))
            cached_full = {"releases": all_releases}
            await upsert_external_cache(
                source="discogs_label_releases_sorted",
                cache_key=full_cache_key,
                payload=cached_full,
            )

        releases: list[dict] = cached_full.get("releases", [])
        total = len(releases)
        pages = max(1, (total + per_page - 1) // per_page) if total else 0
        start = (page - 1) * per_page
        end = start + per_page
        slice_ = releases[start:end]

        return {
            "releases": slice_,
            "pagination": {
                "page": page,
                "pages": pages,
                "per_page": per_page,
                "items": total,
            },
        }

    async def get_tracklist(self, release_id: int, release_type: str = "release") -> list[dict]:
        """
        Get full tracklist for a release or master release.
        release_type: "master" or "release"

        Cached for 6 months — release tracklists are user-edited and the
        long tail of corrections lands within ~6mo of publish; older releases
        are essentially frozen.
        """
        if not settings.discogs_token:
            return []
        cache_key = f"{release_id}|{release_type}"
        cached = await fetch_external_cache(
            source="discogs_tracklist",
            cache_key=cache_key,
            ttl_seconds=_TTL_6MO,
        )
        if cached is not None:
            return cached
        endpoint = (
            f"/masters/{release_id}"
            if release_type == "master"
            else f"/releases/{release_id}"
        )
        resp = await self._get(endpoint)
        data = resp.json()
        out = [
            {
                "position": t.get("position", ""),
                "title": t.get("title", "Unknown"),
                "duration": t.get("duration", ""),
                "artists": [a.get("name", "") for a in t.get("artists", [])],
            }
            for t in data.get("tracklist", [])
            if t.get("type_") != "heading"
        ]
        await upsert_external_cache(
            source="discogs_tracklist",
            cache_key=cache_key,
            payload=out,
        )
        return out

    # ── Collaborative similars ────────────────────────────────────────────────

    async def find_similar(self, query: str, limit: int) -> list[TrackMeta]:
        """Hot-path collaborative similars — reads the warm cache ONLY.

        The owner list lives behind Cloudflare and the collection fan-out is
        slow, so the actual build runs offline (`build_collaborative`, driven by
        scripts/warm_discogs_similar.py). A cold seed returns [] rather than
        adding the scrape + N collection calls to the /similar critical path.
        """
        if not settings.discogs_token:
            return []
        cached = await fetch_external_cache(
            source="discogs_similar",
            cache_key=_normalize_query(query),
            ttl_seconds=_COLLAB_TTL,
        )
        if cached is None:
            # Cold or expired seed → let the background worker (re)build it.
            # A cached empty list is a real "no matches" result, so it's kept
            # (returned below) and does NOT re-trigger a warm.
            if " - " in query:
                request_warm(query)
            return []
        return [TrackMeta(**t) for t in cached][:limit]

    async def build_collaborative(
        self, query: str, limit: int = _COLLAB_OUTPUT_LIMIT
    ) -> list[TrackMeta]:
        """Offline build: seed → Have/Want collectors → their on-genre releases.

        Resolves the seed release, samples up to `_COLLAB_MAX_USERS` collectors
        (Have first, topping up from Want), and pulls up to
        `_COLLAB_TRACKS_PER_USER` releases per collector whose Discogs styles
        overlap the seed's. Writes the result to the `discogs_similar` cache and
        returns it. Soft-degrades to [] (token / seed / owner-list unavailable).
        """
        if not settings.discogs_token:
            return []
        artist, track = _split_query(query)
        try:
            release_id, seed_styles, seed_genres = await self._resolve_seed(artist, track)
        except httpx.HTTPError as e:
            print(f"[Discogs] seed resolve failed q={query!r}: {e}")
            return []
        if not release_id:
            return []

        seed_targets = _seed_match_targets(seed_styles)
        users = await self._fetch_release_users(release_id)
        candidates = (users.get("have", []) + users.get("want", []))[:_COLLAB_CANDIDATE_CAP]

        tracks: list[TrackMeta] = []
        seen_urls: set[str] = set()
        used = 0
        for username in candidates:
            if used >= _COLLAB_MAX_USERS or len(tracks) >= limit:
                break
            matches = await self._collection_matches(
                username, seed_targets, seed_genres, release_id
            )
            if not matches:
                continue  # private / empty / off-genre — try the next collector
            used += 1
            for t in matches:
                if t.sourceUrl in seen_urls:
                    continue
                seen_urls.add(t.sourceUrl)
                tracks.append(t)
                if len(tracks) >= limit:
                    break

        result = tracks[:limit]
        # Cache write is best-effort: a DB outage must not discard the work we
        # just did (the /similar read path is already DB-guarded by the route).
        try:
            await upsert_external_cache(
                source="discogs_similar",
                cache_key=_normalize_query(query),
                payload=[t.model_dump() for t in result],
            )
        except Exception as e:
            print(f"[Discogs] cache write skipped (db unavailable): {e}")
        return result

    async def _resolve_seed(self, artist: str, track: str) -> tuple[int | None, set[str], set[str]]:
        """Resolve a query to a Discogs release, reading styles/genres straight
        off the search result (no extra release fetch). Returns (id, styles, genres).

        The user gives "artist - track", so we match by the `track` param —
        Discogs returns the release that *contains* that track (searching `q`
        would only match release titles). Falls back to a release-title match
        when the term isn't a track (e.g. an EP name). Artist-only queries seed
        from the artist's most relevant release."""
        if not artist and not track:
            return None, set(), set()
        seed = await self._search_release(artist, {"track": track} if track else {})
        if seed[0] is None and track:
            seed = await self._search_release(artist, {"release_title": track})
        return seed

    async def _search_release(self, artist: str, extra: dict) -> tuple[int | None, set[str], set[str]]:
        params: dict = {"type": "release", "per_page": 5}
        if artist:
            params["artist"] = artist
        params.update(extra)
        resp = await self._get("/database/search", params=params)
        for r in resp.json().get("results", []):
            rid = r.get("id")
            if rid:
                styles = {s.lower() for s in (r.get("style") or [])}
                genres = {g.lower() for g in (r.get("genre") or [])}
                return rid, styles, genres
        return None, set(), set()

    async def _fetch_release_users(self, release_id: int) -> dict[str, list[str]]:
        """Have/Want collector usernames for a release, read off the Cloudflare-
        gated www stats page via a FlareSolverr endpoint (DISCOGS_STATS_UNBLOCKER_URL,
        e.g. http://flaresolverr:8191/v1). FlareSolverr solves the challenge in a
        real browser and returns the rendered HTML in solution.response.
        Soft-degrades to empty lists when unset or on any fetch/parse error."""
        endpoint = settings.discogs_stats_unblocker_url
        if not endpoint:
            return {"have": [], "want": []}
        stats_url = f"{WWW_URL}/release/stats/{release_id}"
        try:
            resp = await self._stats_client.post(
                endpoint,
                json={"cmd": "request.get", "url": stats_url, "maxTimeout": 60000},
            )
            resp.raise_for_status()
            html = resp.json()["solution"]["response"]
            return _parse_stats_usernames(html)
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as e:
            print(f"[Discogs] stats fetch failed release={release_id}: {e}")
            return {"have": [], "want": []}

    async def _collection_matches(
        self,
        username: str,
        seed_targets: set[str],
        seed_genres: set[str],
        exclude_release_id: int,
    ) -> list[TrackMeta]:
        """Up to `_COLLAB_TRACKS_PER_USER` releases from a collector whose style
        family is in the seed's match targets (own families + one-way broadenings),
        newest-added first. Genre overlap is the fallback when the seed has no
        styles. Skips the seed itself."""
        try:
            resp = await self._get(
                f"/users/{username}/collection/folders/0/releases",
                params={"per_page": 100, "sort": "added", "sort_order": "desc"},
            )
        except httpx.HTTPError as e:
            print(f"[Discogs] collection fetch failed user={username}: {e}")
            return []
        out: list[TrackMeta] = []
        for item in resp.json().get("releases", []):
            if len(out) >= _COLLAB_TRACKS_PER_USER:
                break
            basic = item.get("basic_information") or {}
            if basic.get("id") == exclude_release_id:
                continue
            styles = {s.lower() for s in (basic.get("styles") or [])}
            genres = {g.lower() for g in (basic.get("genres") or [])}
            if seed_targets:
                if not (_style_families(styles) & seed_targets):
                    continue
            elif seed_genres and not (genres & seed_genres):
                continue
            track = _track_from_collection_item(basic)
            if track is not None:
                out.append(track)
        return out
