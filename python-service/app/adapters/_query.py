"""Shared query parsing for adapters.

The /similar route passes `"Artist - Track"` (or a bare `"Artist"` in
artist-only mode). Every adapter splits it the same way, so the logic lives
here instead of being copy-pasted per adapter.
"""


def split_artist_track(query: str) -> tuple[str, str | None]:
    """Parse `"Artist - Track"` → `(artist, track)`. Returns `(artist, None)`
    when there is no `" - "` separator or the track half is empty. Adapters
    that require a track short-circuit on the `(artist, None)` shape."""
    artist, sep, track = query.partition(" - ")
    artist = artist.strip()
    if not sep:
        return artist, None
    track = track.strip()
    return artist, (track or None)
