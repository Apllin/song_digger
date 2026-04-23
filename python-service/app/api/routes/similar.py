import re
import asyncio
from collections import Counter
from fastapi import APIRouter
from app.core.models import SimilarRequest, SimilarResponse, TrackMeta
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.adapters.cosine_club import CosineClubAdapter
from app.adapters.beatport import BeatportAdapter
from app.adapters.bandcamp import BandcampAdapter

router = APIRouter()

_ytm = YouTubeMusicAdapter()
_cosine = CosineClubAdapter()
_beatport = BeatportAdapter()
_bandcamp = BandcampAdapter()

BANDCAMP_TIMEOUT = 4.0  # seconds — skip if Bandcamp is slow, don't block the response


async def _bandcamp_safe(query: str) -> list[TrackMeta]:
    """Run Bandcamp 'you may also like' with a hard timeout so it never blocks the main flow."""
    try:
        return await asyncio.wait_for(_bandcamp.find_similar(query), timeout=BANDCAMP_TIMEOUT)
    except asyncio.TimeoutError:
        print(f"[Bandcamp] timed out after {BANDCAMP_TIMEOUT}s, skipping")
        return []
    except Exception as e:
        print(f"[Bandcamp] error: {e}")
        return []

MAX_TRACKS = 500
# Beatport enrichment: keep low — each track is one HTTP request to Beatport.
ENRICH_LIMIT = 4
ENRICH_CONCURRENCY = 8


def _normalize(s: str) -> str:
    return s.lower().strip()


def _same_artist(a: str, b: str) -> bool:
    """
    Token-based artist comparison.

    "Oscar Mulero" matches "Oscar Mulero & Ancient Methods" because every token
    of the shorter name appears as a whole word in the longer one.
    Single letters like "A" won't match "Anastasia" because "a" != "anastasia".

    Examples:
        "Oscar Mulero" vs "Oscar Mulero & Ancient Methods" → True
        "A"            vs "Anastasia"                      → False
        "Bob"          vs "Bobby Brown"                    → False  (no token "bob" in {"bobby","brown"})
        "Daft"         vs "Daft Punk"                      → True
    """
    a, b = _normalize(a), _normalize(b)
    if a == b:
        return True
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return False
    # All tokens of the shorter name must appear word-for-word in the longer
    shorter = tokens_a if len(tokens_a) <= len(tokens_b) else tokens_b
    longer  = tokens_b if len(tokens_a) <= len(tokens_b) else tokens_a
    return shorter.issubset(longer)


def _normalize_title(s: str) -> str:
    """Strip common suffixes like '(Original Mix)', '(feat. X)' for comparison."""
    s = s.lower().strip()
    s = re.sub(r"\s*\(original mix\)", "", s)
    s = re.sub(r"\s*\(feat\..*?\)", "", s)
    s = re.sub(r"\s*\[.*?\]", "", s)
    return s.strip()


def _has_metadata(t: TrackMeta) -> bool:
    return t.bpm is not None or t.key is not None


def _deduplicate(tracks: list[TrackMeta]) -> list[TrackMeta]:
    """
    Deduplicate by sourceUrl first, then by normalised artist+title.
    Prevents the same track from appearing twice when it comes from
    both YTM and Bandcamp (different URLs, same content).
    Keeps the copy with BPM/key metadata; on a tie, first-seen wins.

    Big-O: O(n) — uses index map instead of list scan for replacement.
    """
    seen_urls: set[str] = set()
    # identity key → index in result list (for O(1) replacement)
    identity_index: dict[str, int] = {}
    result: list[TrackMeta] = []

    for t in tracks:
        if t.sourceUrl in seen_urls:
            continue
        seen_urls.add(t.sourceUrl)

        identity_key = f"{_normalize(t.artist)}||{_normalize_title(t.title)}"
        if identity_key in identity_index:
            existing_idx = identity_index[identity_key]
            existing = result[existing_idx]
            # Replace in-place if current has metadata and existing does not
            if _has_metadata(t) and not _has_metadata(existing):
                seen_urls.discard(existing.sourceUrl)
                seen_urls.add(t.sourceUrl)
                result[existing_idx] = t
                identity_index[identity_key] = existing_idx
        else:
            identity_index[identity_key] = len(result)
            result.append(t)

    return result


COSINE_CONFIDENCE_THRESHOLD = 0.5

def _extract_source_meta(
    cosine_tracks: list[TrackMeta],
) -> tuple[float | None, str | None, float | None, bool]:
    """
    Infer the source track's BPM, key, and energy from the top Cosine.club results.
    Uses median BPM/energy and most common key of the first 5 results.

    Also returns a confidence flag: False when the average Cosine score is
    below COSINE_CONFIDENCE_THRESHOLD, meaning Cosine likely doesn't know
    the track and the metadata inference is unreliable.
    """
    top = cosine_tracks[:5]

    scores = [t.score for t in top if t.score is not None]
    confident = bool(scores) and (sum(scores) / len(scores)) >= COSINE_CONFIDENCE_THRESHOLD

    bpms = sorted(t.bpm for t in top if t.bpm is not None)
    keys = [t.key for t in top if t.key is not None]
    energies = sorted(t.energy for t in top if t.energy is not None)

    source_bpm = bpms[len(bpms) // 2] if bpms else None
    source_key = Counter(keys).most_common(1)[0][0] if keys else None
    source_energy = energies[len(energies) // 2] if energies else None
    return source_bpm, source_key, source_energy, confident


async def _empty_list() -> list:
    return []


async def _find_by_artist_and_track(
    artist: str, track: str, limit: int
) -> tuple[list[TrackMeta], str | None, float | None, str | None, float | None]:
    full_query = f"{artist} - {track}"
    # Users sometimes type queries as "Track - Artist" instead of "Artist - Track".
    # Try both orderings for Cosine so we hit its catalog regardless of input order.
    reversed_query = f"{track} - {artist}"

    # Phase 1: all external sources in parallel.
    cosine_tracks, ytm_tracks, bandcamp_tracks, ytm_source_search = await asyncio.gather(
        _cosine.find_similar(full_query, limit),
        _ytm.find_similar(full_query, limit),
        _bandcamp_safe(full_query),
        _ytm.search_songs(full_query, limit=1),
        return_exceptions=True,
    )

    cosine_tracks = cosine_tracks if isinstance(cosine_tracks, list) else []
    ytm_tracks = ytm_tracks if isinstance(ytm_tracks, list) else []
    bandcamp_tracks = bandcamp_tracks if isinstance(bandcamp_tracks, list) else []
    ytm_source_search = ytm_source_search if isinstance(ytm_source_search, list) else []

    # Derive source artist from the YTM *search result* for the queried track —
    # this is the actual performer, unlike ytm_tracks[0] which is already a
    # *similar* (radio) track and may be a completely different artist.
    # Use only the PRIMARY (first) artist to avoid compound strings like
    # "Sascha Funke, Nina Kraviz" that break _same_artist token matching.
    ytm_source_artist: str | None = None
    if ytm_source_search:
        artists_list = ytm_source_search[0].get("artists") or []
        if artists_list:
            ytm_source_artist = artists_list[0].get("name") or None

    source_bpm, source_key, source_energy, cosine_confident = _extract_source_meta(cosine_tracks)

    # Phase 2 (slow path): all fallbacks run in parallel so sequential waits collapse.
    artist_cosine: list[TrackMeta] = []
    if not cosine_confident:
        reversed_coro = (
            _cosine.find_similar(reversed_query, limit)
            if reversed_query != full_query
            else _empty_list()
        )
        # Bandcamp artist fallback: only needed when Phase 1 returned nothing.
        bandcamp_fallback_coro = (
            _bandcamp_safe(artist) if not bandcamp_tracks else _empty_list()
        )

        (
            reversed_cosine_raw,
            beatport_results_raw,
            artist_cosine_raw,
            bandcamp_fallback_raw,
        ) = await asyncio.gather(
            reversed_coro,
            _beatport.find_similar(full_query, limit=3),
            _cosine.find_similar(artist, limit),
            bandcamp_fallback_coro,
            return_exceptions=True,
        )

        reversed_cosine = reversed_cosine_raw if isinstance(reversed_cosine_raw, list) else []
        beatport_results = beatport_results_raw if isinstance(beatport_results_raw, list) else []
        bandcamp_fallback = bandcamp_fallback_raw if isinstance(bandcamp_fallback_raw, list) else []

        if reversed_cosine:
            rev_bpm, rev_key, rev_energy, rev_confident = _extract_source_meta(reversed_cosine)
            if rev_confident or len(reversed_cosine) > len(cosine_tracks):
                cosine_tracks = reversed_cosine
                source_bpm, source_key, source_energy, cosine_confident = rev_bpm, rev_key, rev_energy, rev_confident

        # Use Beatport for source BPM/key if Cosine is still not confident.
        if not cosine_confident:
            title_lower = track.lower()
            artist_lower = artist.lower()
            for t in beatport_results:
                if t.bpm and t.key:
                    if artist_lower[:6] in t.artist.lower() or title_lower[:6] in t.title.lower():
                        source_bpm = t.bpm
                        source_key = t.key
                        break

        # Cosine artist fallback: style-adjacent tracks for the artist.
        # No score filter here — artist search often returns score=None (text-matched
        # results) which are still genre-relevant. The aggregator scores them on
        # BPM/key/sourceRank; audioSimilarity simply contributes 0 when score is None.
        artist_cosine = artist_cosine_raw if isinstance(artist_cosine_raw, list) else []

        # Use Bandcamp artist results if the track-specific search found nothing.
        if not bandcamp_tracks:
            bandcamp_tracks = bandcamp_fallback

    # Drop low-confidence track Cosine results.
    if not cosine_confident:
        cosine_tracks = [t for t in cosine_tracks if t.score is not None and t.score >= COSINE_CONFIDENCE_THRESHOLD]

    # Append artist-based Cosine tracks as supplement (after filtering above).
    cosine_tracks = cosine_tracks + artist_cosine

    # Priority for source_artist:
    #   1. YTM search result artist (most reliable — it's the actual queried track)
    #   2. First Cosine result artist (audio-similarity match, usually correct)
    #   3. First YTM radio result artist (least reliable — a similar, not the source)
    source_artist: str | None = (
        ytm_source_artist
        or (cosine_tracks[0].artist if cosine_tracks else None)
        or (ytm_tracks[0].artist if ytm_tracks else None)
    )

    all_tracks = cosine_tracks + ytm_tracks + bandcamp_tracks
    if source_artist:
        all_tracks = [t for t in all_tracks if not _same_artist(t.artist, source_artist)]

    return all_tracks, source_artist, source_bpm, source_key, source_energy


async def _find_by_artist_only(
    artist: str, limit: int
) -> tuple[list[TrackMeta], str | None, float | None, str | None, float | None]:
    """
    Artist-only mode: Cosine + YTM artist playlist, all in parallel.
    If Cosine returns few results, seeds a second query with the artist's top track.
    """
    cosine_artist, ytm_artist, top_songs = await asyncio.gather(
        _cosine.find_similar(artist, limit),
        _ytm.find_similar_by_artist(artist, limit),
        _ytm.search_songs(artist, limit=1),
        return_exceptions=True,
    )

    cosine_tracks: list[TrackMeta] = cosine_artist if isinstance(cosine_artist, list) else []
    ytm_tracks: list[TrackMeta] = ytm_artist if isinstance(ytm_artist, list) else []

    # If the artist-only Cosine query returned few results, seed with a specific track
    if isinstance(top_songs, list) and top_songs and len(cosine_tracks) < 8:
        top_title = top_songs[0].get("title", "")
        if top_title:
            seeded = await _cosine.find_similar(f"{artist} - {top_title}", limit)
            if isinstance(seeded, list) and len(seeded) > len(cosine_tracks):
                cosine_tracks = seeded

    source_bpm, source_key, source_energy, _ = _extract_source_meta(cosine_tracks)

    all_tracks = cosine_tracks + ytm_tracks
    all_tracks = [t for t in all_tracks if not _same_artist(t.artist, artist)]

    return all_tracks, artist, source_bpm, source_key, source_energy


@router.post("/similar", response_model=SimilarResponse)
async def find_similar(req: SimilarRequest) -> SimilarResponse:
    if req.track:
        all_tracks, source_artist, source_bpm, source_key, source_energy = await _find_by_artist_and_track(
            req.artist, req.track, req.limit_per_source
        )
    else:
        all_tracks, source_artist, source_bpm, source_key, source_energy = await _find_by_artist_only(
            req.artist, req.limit_per_source
        )

    all_tracks = _deduplicate(all_tracks)[:MAX_TRACKS]

    # Enrich only the first ENRICH_LIMIT tracks that lack BPM/key.
    # Prioritise Cosine tracks (they already have BPM/key, so this mostly hits YTM).
    to_enrich = [t for t in all_tracks if t.bpm is None or t.key is None][:ENRICH_LIMIT]
    if to_enrich:
        enriched_map = await _beatport.enrich_tracks(to_enrich, max_concurrent=ENRICH_CONCURRENCY)
        all_tracks = [enriched_map.get(t.sourceUrl, t) for t in all_tracks]

    return SimilarResponse(
        tracks=all_tracks,
        source_artist=source_artist,
        source_bpm=source_bpm,
        source_key=source_key,
        source_energy=source_energy,
    )
