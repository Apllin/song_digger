"""Label discography orchestrator — Discogs primary, Bandcamp staleness fallback. See ADR-0024."""
import asyncio
import re
import unicodedata
from datetime import datetime, timezone

from app.adapters.bandcamp import BandcampAdapter, _bandcamp_cover_url
from app.adapters.discogs import DiscogsAdapter

_MAX_BANDCAMP_FETCHES = 12
_STALENESS_YEAR_THRESHOLD = 1


def _normalize_for_match(s: str) -> str:
    """NFKD + lowercase + strip mild punctuation + collapse whitespace."""
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    no_punct = re.sub(r"[.,!?'\"]", "", stripped.lower())
    return " ".join(no_punct.split())


def _pick_bandcamp_label_match(name: str, matches: list[dict]) -> dict | None:
    """First exact case-insensitive name match; None on no exact hit (no fuzzy)."""
    target = _normalize_for_match(name)
    if not target:
        return None
    for m in matches:
        if _normalize_for_match(m.get("name") or "") == target:
            return m
    return None


async def get_label_releases_combined(
    *,
    discogs: DiscogsAdapter,
    bandcamp: BandcampAdapter,
    label_id: int,
    label_name: str,
    page: int,
    per_page: int,
) -> dict:
    # per_page big enough to capture every release for the staleness check;
    # adapter does post-fetch slicing so it's free.
    discogs_full = await discogs.get_label_releases(label_id, page=1, per_page=10000)
    discogs_releases = discogs_full.get("releases", [])

    current_year = datetime.now(timezone.utc).year
    years = [r["year"] for r in discogs_releases if r.get("year")]
    max_year = max(years) if years else 0
    is_stale = (current_year - max_year) > _STALENESS_YEAR_THRESHOLD

    bandcamp_releases: list[dict] = []
    if is_stale and label_name:
        bc_matches = await bandcamp.search_label(label_name, limit=10)
        bc_label = _pick_bandcamp_label_match(label_name, bc_matches)

        if bc_label:
            bc_discography = await bandcamp.get_label_discography(bc_label["url"])
            discogs_title_set = {
                _normalize_for_match(r.get("title") or "")
                for r in discogs_releases
                if r.get("title")
            }
            missing = [
                r for r in bc_discography
                if _normalize_for_match(r.get("title") or "") not in discogs_title_set
            ]
            # Bandcamp item ids increase (roughly) with upload order per
            # account — proxy for "newest first" when capping fetches.
            missing.sort(key=lambda r: -(r.get("id") or 0))
            missing = missing[:_MAX_BANDCAMP_FETCHES]

            if missing:
                metas = await asyncio.gather(
                    *(bandcamp.get_release_meta(r["absolute_url"]) for r in missing),
                    return_exceptions=True,
                )
                for bc_item, meta in zip(missing, metas):
                    if isinstance(meta, BaseException) or not meta:
                        continue
                    bandcamp_releases.append({
                        "id": bc_item.get("id") or 0,
                        "title": meta.get("title") or bc_item.get("title") or "",
                        "year": meta.get("year"),
                        "artist": meta.get("artist") or bc_item.get("artist") or None,
                        "format": None,
                        "catno": None,
                        "thumb": _bandcamp_cover_url(
                            meta.get("art_id") or bc_item.get("art_id")
                        ),
                        "type": bc_item.get("type"),
                        "source": "bandcamp",
                        "sourceUrl": bc_item.get("absolute_url"),
                    })

    for r in discogs_releases:
        r.setdefault("source", "discogs")
        r.setdefault("sourceUrl", None)

    combined = discogs_releases + bandcamp_releases
    combined.sort(key=lambda r: (r.get("year") is None, -(r.get("year") or 0)))

    total = len(combined)
    pages = max(1, (total + per_page - 1) // per_page) if total else 0
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "releases": combined[start:end],
        "pagination": {
            "page": page,
            "pages": pages,
            "per_page": per_page,
            "items": total,
        },
    }
