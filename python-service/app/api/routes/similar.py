import asyncio
import unicodedata
from fastapi import APIRouter
from app.core.models import SimilarRequest, SimilarResponse, SourceList, TrackMeta
from app.core.title_norm import strip_recording_suffixes
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.adapters.cosine_club import CosineClubAdapter
from app.adapters.bandcamp import BandcampAdapter
from app.adapters.yandex_music import YandexMusicAdapter
from app.adapters.lastfm import LastfmAdapter
from app.adapters.trackidnet import TrackidnetAdapter

router = APIRouter()

_ytm = YouTubeMusicAdapter()
_cosine = CosineClubAdapter()
_bandcamp = BandcampAdapter()
_yandex = YandexMusicAdapter()
_lastfm = LastfmAdapter()
_trackidnet = TrackidnetAdapter()

BANDCAMP_TIMEOUT = 4.0  # seconds — skip if Bandcamp is slow, don't block the response
# Trackidnet does up to 17 sequential-batched HTTP calls per seed (1 search +
# 1 playlists-list + up to 15 detail fetches with Semaphore(5) inside the
# adapter — see ADR-0014). Cold-path wall clock is ~8-15s when trackid is
# responsive, longer when it's slow. Cap above the realistic cold path so we
# don't silently drop trackid contributions on every fresh search, but still
# bounded so one slow seed doesn't stall the /similar fan-out.
TRACKIDNET_TIMEOUT = 25.0


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


async def _trackidnet_safe(query: str, limit: int) -> list[TrackMeta]:
    """Run trackid.net with a hard timeout — cold-cache scrape can take several seconds."""
    try:
        return await asyncio.wait_for(
            _trackidnet.find_similar(query, limit), timeout=TRACKIDNET_TIMEOUT
        )
    except asyncio.TimeoutError:
        print(f"[Trackidnet] timed out after {TRACKIDNET_TIMEOUT}s, skipping")
        return []
    except Exception as e:
        print(f"[Trackidnet] error: {e}")
        return []

def _normalize(s: str) -> str:
    # NFKD-decompose so accented forms split into base + combining marks,
    # then drop the marks. Mirrored in web/lib/aggregator.ts:normalizeArtist —
    # without this, "Óscar Mulero" and "Oscar Mulero" produce different tokens
    # in _same_artist and the seed-artist filter silently misses one of them.
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return stripped.lower().strip()


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
    """Lower-case and strip whitelisted recording-equivalence suffixes for dedup.
    Preserves version markers like (Remix), (Dub), (Live), (VIP), (Instrumental).
    The whitelist lives in `app.core.title_norm` so seed-match validation and
    output dedup can't drift apart."""
    return strip_recording_suffixes(s.lower().strip()).strip()


COSINE_CONFIDENCE_THRESHOLD = 0.5

def _cosine_is_confident(cosine_tracks: list[TrackMeta]) -> bool:
    """
    True when the average Cosine score over the top 5 results is at or above
    COSINE_CONFIDENCE_THRESHOLD. False means Cosine likely doesn't know the
    seed and Phase 2 reversed-query / artist-fallback should run.
    """
    top = cosine_tracks[:5]
    scores = [t.score for t in top if t.score is not None]
    return bool(scores) and (sum(scores) / len(scores)) >= COSINE_CONFIDENCE_THRESHOLD


async def _empty_list() -> list:
    return []


def _dedup_within_source(tracks: list[TrackMeta]) -> list[TrackMeta]:
    """Drop duplicate sourceUrls within a single source's ranked list, preserving order."""
    seen: set[str] = set()
    out: list[TrackMeta] = []
    for t in tracks:
        if t.sourceUrl in seen:
            continue
        seen.add(t.sourceUrl)
        out.append(t)
    return out


async def _find_by_artist_and_track(
    artist: str, track: str, limit: int
) -> tuple[list[SourceList], str | None]:
    full_query = f"{artist} - {track}"
    # Users sometimes type queries as "Track - Artist" instead of "Artist - Track".
    # Try both orderings for Cosine so we hit its catalog regardless of input order.
    reversed_query = f"{track} - {artist}"

    # Phase 1: all external sources in parallel.
    (
        cosine_tracks,
        ytm_tracks,
        bandcamp_tracks,
        yandex_tracks,
        lastfm_tracks,
        trackidnet_tracks,
        ytm_source_search,
    ) = await asyncio.gather(
        _cosine.find_similar(full_query, limit),
        _ytm.find_similar(full_query, limit),
        _bandcamp_safe(full_query),
        _yandex.find_similar(full_query, limit),
        _lastfm.find_similar(full_query, limit),
        _trackidnet_safe(full_query, limit),
        _ytm.search_songs(full_query, limit=1),
        return_exceptions=True,
    )

    cosine_tracks = cosine_tracks if isinstance(cosine_tracks, list) else []
    ytm_tracks = ytm_tracks if isinstance(ytm_tracks, list) else []
    bandcamp_tracks = bandcamp_tracks if isinstance(bandcamp_tracks, list) else []
    yandex_tracks = yandex_tracks if isinstance(yandex_tracks, list) else []
    lastfm_tracks = lastfm_tracks if isinstance(lastfm_tracks, list) else []
    trackidnet_tracks = trackidnet_tracks if isinstance(trackidnet_tracks, list) else []
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

    cosine_confident = _cosine_is_confident(cosine_tracks)

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
            artist_cosine_raw,
            bandcamp_fallback_raw,
        ) = await asyncio.gather(
            reversed_coro,
            _cosine.find_similar(artist, limit),
            bandcamp_fallback_coro,
            return_exceptions=True,
        )

        reversed_cosine = reversed_cosine_raw if isinstance(reversed_cosine_raw, list) else []
        bandcamp_fallback = bandcamp_fallback_raw if isinstance(bandcamp_fallback_raw, list) else []

        if reversed_cosine:
            rev_confident = _cosine_is_confident(reversed_cosine)
            if rev_confident or len(reversed_cosine) > len(cosine_tracks):
                cosine_tracks = reversed_cosine
                cosine_confident = rev_confident

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

    # Per-source ranked lists. Each list preserves its adapter's ordering — RRF
    # in the web aggregator fuses across sources using these ranks.
    def _filter_artist(ts: list[TrackMeta]) -> list[TrackMeta]:
        if not source_artist:
            return ts
        return [t for t in ts if not _same_artist(t.artist, source_artist)]

    source_lists = [
        SourceList(source="cosine_club", tracks=_dedup_within_source(_filter_artist(cosine_tracks))),
        SourceList(source="youtube_music", tracks=_dedup_within_source(_filter_artist(ytm_tracks))),
        SourceList(source="bandcamp", tracks=_dedup_within_source(_filter_artist(bandcamp_tracks))),
        SourceList(source="yandex_music", tracks=_dedup_within_source(_filter_artist(yandex_tracks))),
        SourceList(source="lastfm", tracks=_dedup_within_source(_filter_artist(lastfm_tracks))),
        SourceList(source="trackidnet", tracks=_dedup_within_source(_filter_artist(trackidnet_tracks))),
    ]

    return source_lists, source_artist


async def _find_by_artist_only(
    artist: str, limit: int
) -> tuple[list[SourceList], str | None]:
    """
    Artist-only mode: Cosine + YTM artist playlist + Yandex similar, all in parallel.
    If Cosine returns few results, seeds a second query with the artist's top track.
    """
    cosine_artist, ytm_artist, yandex_artist, top_songs = await asyncio.gather(
        _cosine.find_similar(artist, limit),
        _ytm.find_similar_by_artist(artist, limit),
        _yandex.find_similar(artist, limit),
        _ytm.search_songs(artist, limit=1),
        return_exceptions=True,
    )

    cosine_tracks: list[TrackMeta] = cosine_artist if isinstance(cosine_artist, list) else []
    ytm_tracks: list[TrackMeta] = ytm_artist if isinstance(ytm_artist, list) else []
    yandex_tracks: list[TrackMeta] = yandex_artist if isinstance(yandex_artist, list) else []

    # If the artist-only Cosine query returned few results, seed with a specific track
    if isinstance(top_songs, list) and top_songs and len(cosine_tracks) < 8:
        top_title = top_songs[0].get("title", "")
        if top_title:
            seeded = await _cosine.find_similar(f"{artist} - {top_title}", limit)
            if isinstance(seeded, list) and len(seeded) > len(cosine_tracks):
                cosine_tracks = seeded

    def _filter_artist(ts: list[TrackMeta]) -> list[TrackMeta]:
        return [t for t in ts if not _same_artist(t.artist, artist)]

    source_lists = [
        SourceList(source="cosine_club", tracks=_dedup_within_source(_filter_artist(cosine_tracks))),
        SourceList(source="youtube_music", tracks=_dedup_within_source(_filter_artist(ytm_tracks))),
        SourceList(source="yandex_music", tracks=_dedup_within_source(_filter_artist(yandex_tracks))),
    ]

    return source_lists, artist


@router.post("/similar", response_model=SimilarResponse)
async def find_similar(req: SimilarRequest) -> SimilarResponse:
    if req.track:
        source_lists, source_artist = await _find_by_artist_and_track(
            req.artist, req.track, req.limit_per_source
        )
    else:
        source_lists, source_artist = await _find_by_artist_only(
            req.artist, req.limit_per_source
        )

    return SimilarResponse(
        source_lists=source_lists,
        source_artist=source_artist,
    )
