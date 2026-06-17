"""Troi (ListenBrainz lb-radio) adapter — TRA-28.

Runs ListenBrainz's Troi `lb-radio` patch in Global mode as an in-process
library. Global mode returns recording MBIDs only, which is what we want: the
web side resolves MBIDs to vinyl via the existing Discogs resolver. We surface
each recording as a MusicBrainz recording URL so the downstream resolver has a
stable handle.

The patch is synchronous and does its own blocking HTTP, so every run is
off-loaded to a worker thread. ListenBrainz's backend periodically 503s with no
SLA, so the adapter is degradable by design: short-circuits on a per-process
circuit breaker after repeated failures and otherwise collapses to `return []`
— the `/similar` fan-out treats Troi as just another optional source. Result
caching lives at the /similar endpoint level, not here.
"""
import asyncio
import time

from app.adapters.base import AbstractAdapter
from app.config import settings
from app.core.models import ParsedQuery, TrackMeta
from app.services.troi_tags import build_lb_radio_prompt

SOURCE = "troi"
DEFAULT_LIMIT = 50
# Hard wall-clock cap for one lb-radio run. The patch fans out across several
# MB/LB endpoints sequentially; a cold run is a few seconds, but a hung backend
# must not stall the /similar gather.
RUN_TIMEOUT_SECONDS = 20.0
MB_RECORDING_URL = "https://musicbrainz.org/recording/"
# lb-radio emits this in user_feedback() when the seed artist has no
# collaborative-filtering neighbours in ListenBrainz — its cue that the run
# fell back to non-similarity fill. Matched case-insensitively.
_NO_SIMILARS_MARKER = "no similar artists"

# Per-process circuit breaker. After N consecutive failures, stop calling Troi
# for a cooldown window instead of hammering a down backend on every search.
_BREAKER_THRESHOLD = 3
_BREAKER_COOLDOWN_SECONDS = 300.0


class _CircuitBreaker:
    """Trips open after `threshold` consecutive failures and stays open for
    `cooldown` seconds. Process-local — good enough for a single worker; a
    multi-worker deploy just gets one cooldown per worker."""

    def __init__(self, threshold: int, cooldown: float) -> None:
        self._threshold = threshold
        self._cooldown = cooldown
        self._failures = 0
        self._open_until = 0.0

    def is_open(self) -> bool:
        if self._failures < self._threshold:
            return False
        if time.monotonic() >= self._open_until:
            # Cooldown elapsed — allow one probe through (half-open).
            self._failures = 0
            return False
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._open_until = 0.0

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            self._open_until = time.monotonic() + self._cooldown


_breaker = _CircuitBreaker(_BREAKER_THRESHOLD, _BREAKER_COOLDOWN_SECONDS)


class TroiAdapter(AbstractAdapter):
    SOURCE = SOURCE

    async def find_similar(self, query: ParsedQuery, limit: int = DEFAULT_LIMIT) -> list[TrackMeta]:
        # discogs_styles wiring is a follow-up (live style resolution adds a
        # network hop to the hot path); for now the prompt rides on the seed
        # artist, which Troi resolves to CF-similar artists natively.
        prompt, mode = build_lb_radio_prompt(
            query.artist, discogs_styles=None, dig_intensity=settings.troi_dig_intensity
        )
        if not prompt:
            return []

        if _breaker.is_open():
            return []

        try:
            rows = await asyncio.wait_for(
                asyncio.to_thread(_run_lb_radio, mode, prompt, limit),
                timeout=RUN_TIMEOUT_SECONDS,
            )
        except Exception as e:
            _breaker.record_failure()
            print(f"[Troi] find_similar error: {e}")
            return []

        _breaker.record_success()
        return [tm for r in rows if (tm := _row_to_track(r))][:limit]

    async def random_techno_track(self) -> TrackMeta | None:
        return None


def _run_lb_radio(mode: str, prompt: str, limit: int) -> list[dict]:
    """Run the lb-radio patch synchronously and return plain dict rows
    (mbid/title/artist). Import is local so a missing/broken troi install
    degrades to [] without breaking module import for the rest of the service."""
    from troi.patches.lb_radio import LBRadioPatch

    patch = LBRadioPatch(
        {"mode": mode, "prompt": prompt, "min_recordings": None, "quiet": True}
    )
    playlist = patch.generate_playlist()
    if playlist is None or not playlist.playlists:
        return []

    # Honesty guard: when ListenBrainz has no collaborative-filtering similar
    # artists for the seed (common for the underground catalogue we target),
    # lb-radio falls back to the seed's own tracks / generic tag fill. That is
    # genre noise, not similarity — surfacing it would misrepresent Troi as a
    # similarity source. Detect the signal in the patch's own feedback and
    # contribute nothing instead. Validated on "Joe Milli" (TRA-28).
    feedback = " ".join(patch.user_feedback() or []).lower()
    if _NO_SIMILARS_MARKER in feedback:
        return []

    rows: list[dict] = []
    for rec in playlist.playlists[0].recordings[:limit]:
        mbid = getattr(rec, "mbid", None)
        if not mbid:
            continue
        credit = getattr(rec, "artist_credit", None)
        artist_name = getattr(credit, "name", None) if credit else None
        rows.append(
            {
                "mbid": str(mbid),
                "title": (rec.name or "").strip(),
                "artist": (artist_name or "").strip(),
            }
        )
    return rows


def _row_to_track(row: dict) -> TrackMeta | None:
    """Map a cached/fresh lb-radio row to TrackMeta. Drops rows missing
    mbid/title/artist."""
    mbid = (row.get("mbid") or "").strip()
    title = (row.get("title") or "").strip()
    artist = (row.get("artist") or "").strip()
    if not mbid or not title or not artist:
        return None
    return TrackMeta(
        title=title,
        artist=artist,
        source=SOURCE,
        sourceUrl=f"{MB_RECORDING_URL}{mbid}",
    )
