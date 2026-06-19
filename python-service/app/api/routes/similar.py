import asyncio
import unicodedata
from fastapi import APIRouter
from app.core.models import SimilarRequest, SimilarResponse, SourceList, TrackMeta
from app.core.title_llm import normalize as normalize_titles
from app.adapters.youtube_music import YouTubeMusicAdapter
from app.adapters.cosine_club import CosineClubAdapter
from app.adapters.yandex_music import YandexMusicAdapter
from app.adapters.lastfm import LastfmAdapter
from app.adapters.trackidnet import TrackidnetAdapter
from app.adapters.soundcloud import SoundCloudAdapter
from app.adapters.discogs import DiscogsAdapter
from app.services.lastfm_hop import expand_via_similar_artists

router = APIRouter()

_ytm = YouTubeMusicAdapter()
_cosine = CosineClubAdapter()
_yandex = YandexMusicAdapter()
_lastfm = LastfmAdapter()
_trackidnet = TrackidnetAdapter()
_soundcloud = SoundCloudAdapter()
# Collaborative (Discogs collections). find_similar is a warm-cache read only —
# the slow owner-scrape + collection fan-out is built offline, so adding it here
# costs one cache lookup and never stalls the critical path. See discogs.py.
_discogs = DiscogsAdapter()

# Trackidnet does up to 12 sequential-batched HTTP calls per seed (1 search +
# 1 playlists-list + up to 10 detail fetches with Semaphore(5) inside the
# adapter — see ADR-0014). Cold-path wall clock is ~8-15s when trackid is
# responsive, longer when it's slow. Cap above the realistic cold path so we
# don't silently drop trackid contributions on every fresh search, but still
# bounded so one slow seed doesn't stall the /similar fan-out.
TRACKIDNET_TIMEOUT = 25.0

# Hop runs serially after the main gather (depends on trackid output for
# seed artists). Cold path ~1s; cap at 5s so a slow Last.fm doesn't stall
# /similar on its longest critical path.
LASTFM_HOP_TIMEOUT = 5.0


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
    # NFKD-fold accents for artist matching in _same_artist — without it
    # "Óscar Mulero" and "Oscar Mulero" produce different tokens and the
    # seed-artist filter silently misses one of them.
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


def _spread_unique_artists(tracks: list[TrackMeta]) -> list[str]:
    """Three artists spanning the trackid co-occurrence range — highest,
    middle, lowest. `tracks` is already ranked by co-occurrence desc."""
    seen: set[str] = set()
    pool: list[str] = []
    for t in tracks:
        key = _normalize(t.artist)
        if not key or key in seen:
            continue
        seen.add(key)
        pool.append(t.artist)
    if len(pool) <= 3:
        return pool
    return [pool[0], pool[len(pool) // 2], pool[-1]]


async def _lastfm_hop_safe(
    seed_artists: list[str], exclude_artists: list[str]
) -> list[TrackMeta]:
    """Run the lastfm hop with a hard timeout — caps the tail-latency cost
    of a slow Last.fm without blocking the rest of /similar."""
    try:
        return await asyncio.wait_for(
            expand_via_similar_artists(
                seed_artists, exclude_artists=exclude_artists
            ),
            timeout=LASTFM_HOP_TIMEOUT,
        )
    except asyncio.TimeoutError:
        print(f"[LastfmHop] timed out after {LASTFM_HOP_TIMEOUT}s, skipping")
        return []
    except Exception as e:
        print(f"[LastfmHop] error: {e}")
        return []


async def _find_by_artist_and_track(
    artist: str, track: str, limit: int
) -> tuple[list[SourceList], str | None]:
    full_query = f"{artist} - {track}"
    # Word-swapped retry for "Track - Artist" input order — see Phase 2. No
    # artist-only Cosine fallback: if Cosine lacks the track, it contributes nothing.
    reversed_query = f"{track} - {artist}"

    # Phase 1: all external sources in parallel.
    (
        cosine_tracks,
        ytm_tracks,
        yandex_tracks,
        lastfm_tracks,
        trackidnet_tracks,
        soundcloud_tracks,
        discogs_tracks,
        ytm_seed,
    ) = await asyncio.gather(
        _cosine.find_similar(full_query, limit),
        _ytm.find_similar(full_query, limit),
        _yandex.find_similar(full_query, limit),
        _lastfm.find_similar(full_query, limit),
        _trackidnet_safe(full_query, limit),
        _soundcloud.find_similar(full_query, limit),
        _discogs.find_similar(full_query, limit),
        _ytm.resolve_seed(full_query),
        return_exceptions=True,
    )

    cosine_tracks = cosine_tracks if isinstance(cosine_tracks, list) else []
    ytm_tracks = ytm_tracks if isinstance(ytm_tracks, list) else []
    yandex_tracks = yandex_tracks if isinstance(yandex_tracks, list) else []
    lastfm_tracks = lastfm_tracks if isinstance(lastfm_tracks, list) else []
    trackidnet_tracks = trackidnet_tracks if isinstance(trackidnet_tracks, list) else []
    soundcloud_tracks = soundcloud_tracks if isinstance(soundcloud_tracks, list) else []
    discogs_tracks = discogs_tracks if isinstance(discogs_tracks, list) else []

    # Resolved YTM seed for the queried track (catalog songs → UGC videos). This
    # is the actual queried track — its artist is the real performer (unlike
    # ytm_tracks[0], which is already a *similar* radio track), and its videoId
    # is the correct URL to seed Cosine (TRA-25). `resolve_seed` already returns
    # the PRIMARY (single) artist, so no compound strings break _same_artist.
    ytm_seed = ytm_seed if isinstance(ytm_seed, dict) else None
    ytm_source_artist: str | None = ytm_seed.get("artist") if ytm_seed else None
    ytm_source_video_id: str | None = ytm_seed.get("videoId") if ytm_seed else None

    cosine_confident = _cosine_is_confident(cosine_tracks)

    # Phase 2a: retry Cosine with the words swapped (handles "Track - Artist" input).
    if not cosine_confident and reversed_query != full_query:
        try:
            reversed_cosine = await _cosine.find_similar(reversed_query, limit)
        except Exception as e:
            print(f"[CosineClub] reversed-query error: {e}")
            reversed_cosine = []
        if reversed_cosine:
            rev_confident = _cosine_is_confident(reversed_cosine)
            if rev_confident or len(reversed_cosine) > len(cosine_tracks):
                cosine_tracks = reversed_cosine
                cosine_confident = rev_confident

    # Phase 2b (TRA-25): text search still found no confident seed — the track
    # is likely absent from Cosine's catalog. Seed from the YTM URL so Cosine
    # parses the exact track and returns real similars instead of nothing. The
    # URL pins the exact track, so trust the output regardless of absolute score.
    if not cosine_confident and ytm_source_video_id:
        ytm_url = f"https://music.youtube.com/watch?v={ytm_source_video_id}"
        try:
            url_cosine = await _cosine.find_similar_by_url(ytm_url, limit)
        except Exception as e:
            print(f"[CosineClub] url-seeded error: {e}")
            url_cosine = []
        if url_cosine:
            cosine_tracks = url_cosine
            cosine_confident = True

    # Drop low-confidence Cosine results when no seed strategy landed a confident hit.
    if not cosine_confident:
        cosine_tracks = [t for t in cosine_tracks if t.score is not None and t.score >= COSINE_CONFIDENCE_THRESHOLD]

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

    # Phase 3: lastfm hop — fan out from query artist + top trackid artists
    # to surface tracks one similarity-hop away. Runs serially after gather
    # because seed-artist selection depends on trackid output. Excludes
    # artists already present in trackid's contribution so the hop doesn't
    # double up on the same lateral cluster.
    trackid_seed_artists = _spread_unique_artists(trackidnet_tracks)
    hop_seed_pool = [artist] + trackid_seed_artists
    hop_exclude = [t.artist for t in trackidnet_tracks if t.artist]
    lastfm_hop_tracks = await _lastfm_hop_safe(hop_seed_pool, hop_exclude)

    source_lists = [
        SourceList(source="cosine_club", tracks=_dedup_within_source(_filter_artist(cosine_tracks))),
        SourceList(source="youtube_music", tracks=_dedup_within_source(_filter_artist(ytm_tracks))),
        SourceList(source="yandex_music", tracks=_dedup_within_source(_filter_artist(yandex_tracks))),
        SourceList(source="lastfm", tracks=_dedup_within_source(_filter_artist(lastfm_tracks))),
        SourceList(source="trackidnet", tracks=_dedup_within_source(_filter_artist(trackidnet_tracks))),
        SourceList(source="soundcloud", tracks=_dedup_within_source(_filter_artist(soundcloud_tracks))),
        SourceList(source="discogs", tracks=_dedup_within_source(_filter_artist(discogs_tracks))),
        SourceList(source="lastfm_hop", tracks=_dedup_within_source(_filter_artist(lastfm_hop_tracks))),
    ]

    return source_lists, source_artist


async def _find_by_artist_only(
    artist: str, limit: int
) -> tuple[list[SourceList], str | None]:
    """
    Artist-only mode. lastfm routes to its artist-level fallback and trackid
    to its keyword flow when no track is supplied. Cosine.club has no
    artist-only search, so it is queried with the artist's top track and
    contributes nothing without an exact catalogue match.
    """
    (
        ytm_artist,
        yandex_artist,
        soundcloud_artist,
        lastfm_artist,
        trackidnet_artist,
        discogs_artist,
        top_songs,
    ) = await asyncio.gather(
        _ytm.find_similar_by_artist(artist, limit),
        _yandex.find_similar(artist, limit),
        _soundcloud.find_similar(artist, limit),
        _lastfm.find_similar(artist, limit),
        _trackidnet_safe(artist, limit),
        _discogs.find_similar(artist, limit),
        _ytm.search_songs(artist, limit=1),
        return_exceptions=True,
    )

    ytm_tracks: list[TrackMeta] = ytm_artist if isinstance(ytm_artist, list) else []
    yandex_tracks: list[TrackMeta] = yandex_artist if isinstance(yandex_artist, list) else []
    soundcloud_tracks: list[TrackMeta] = soundcloud_artist if isinstance(soundcloud_artist, list) else []
    lastfm_tracks: list[TrackMeta] = lastfm_artist if isinstance(lastfm_artist, list) else []
    trackidnet_tracks: list[TrackMeta] = trackidnet_artist if isinstance(trackidnet_artist, list) else []
    discogs_tracks: list[TrackMeta] = discogs_artist if isinstance(discogs_artist, list) else []

    # Cosine.club has no artist-only search — seed it with the artist's top track.
    cosine_tracks: list[TrackMeta] = []
    if isinstance(top_songs, list) and top_songs:
        top_title = top_songs[0].get("title", "")
        if top_title:
            seeded = await _cosine.find_similar(f"{artist} - {top_title}", limit)
            if isinstance(seeded, list):
                cosine_tracks = seeded

    # Lastfm hop — fan out from query artist + top trackid artists, same logic
    # as the track-mode path so artist-only queries also surface lateral
    # similars one hop deeper.
    trackid_seed_artists = _spread_unique_artists(trackidnet_tracks)
    hop_seed_pool = [artist] + trackid_seed_artists
    hop_exclude = [t.artist for t in trackidnet_tracks if t.artist]
    lastfm_hop_tracks = await _lastfm_hop_safe(hop_seed_pool, hop_exclude)

    def _filter_artist(ts: list[TrackMeta]) -> list[TrackMeta]:
        return [t for t in ts if not _same_artist(t.artist, artist)]

    source_lists = [
        SourceList(source="cosine_club", tracks=_dedup_within_source(_filter_artist(cosine_tracks))),
        SourceList(source="youtube_music", tracks=_dedup_within_source(_filter_artist(ytm_tracks))),
        SourceList(source="yandex_music", tracks=_dedup_within_source(_filter_artist(yandex_tracks))),
        SourceList(source="lastfm", tracks=_dedup_within_source(_filter_artist(lastfm_tracks))),
        SourceList(source="trackidnet", tracks=_dedup_within_source(_filter_artist(trackidnet_tracks))),
        SourceList(source="soundcloud", tracks=_dedup_within_source(_filter_artist(soundcloud_tracks))),
        SourceList(source="discogs", tracks=_dedup_within_source(_filter_artist(discogs_tracks))),
        SourceList(source="lastfm_hop", tracks=_dedup_within_source(_filter_artist(lastfm_hop_tracks))),
    ]

    return source_lists, artist


def _fallback_key(s: str) -> str:
    return " ".join(s.lower().split())


async def _normalize_source_titles(source_lists: list[SourceList]) -> list[SourceList]:
    """Fill cleaned display title/artist and canonical artistKey/titleKey on
    every track via one batched LLM call. Raises on failure (no partial writes)."""
    flat = [(t.artist, t.title) for sl in source_lists for t in sl.tracks]
    if not flat:
        return source_lists
    canon = await normalize_titles(flat)
    out: list[SourceList] = []
    it = iter(canon)
    for sl in source_lists:
        tracks = []
        for t in sl.tracks:
            c = next(it)
            # Fall back to minimal raw-key hygiene if the LLM emits an empty key,
            # so keyless tracks never collapse into one fusion bucket.
            tracks.append(t.model_copy(update={
                "title": c.title or t.title,
                "artist": c.artist or t.artist,
                "artistKey": c.artist_key or _fallback_key(t.artist),
                "titleKey": c.title_key or _fallback_key(t.title),
            }))
        out.append(SourceList(source=sl.source, tracks=tracks))
    return out


@router.post(
    "/similar",
    operation_id="find_similar",
    response_model=SimilarResponse,
)
async def find_similar(req: SimilarRequest) -> SimilarResponse:
    if req.track:
        source_lists, source_artist = await _find_by_artist_and_track(
            req.artist, req.track, req.limit_per_source
        )
    else:
        source_lists, source_artist = await _find_by_artist_only(
            req.artist, req.limit_per_source
        )

    source_lists = await _normalize_source_titles(source_lists)

    return SimilarResponse(
        source_lists=source_lists,
        source_artist=source_artist,
    )
