import asyncio
import unicodedata
import httpx
from app.config import settings
from app.core.db import fetch_external_cache, upsert_external_cache

BASE_URL = "https://api.discogs.com"

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

    async def aclose(self) -> None:
        await self._client.aclose()

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
            if r.get("id")
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
