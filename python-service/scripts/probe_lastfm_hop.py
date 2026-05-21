"""One-off: run the full _find_by_artist_and_track flow and dump the
lastfm_hop SourceList alongside trackidnet for comparison."""
import asyncio
import sys
import time

from app.api.routes.similar import _find_by_artist_and_track


async def main() -> None:
    if len(sys.argv) > 1 and " - " in sys.argv[1]:
        artist, _, track = sys.argv[1].partition(" - ")
        artist, track = artist.strip(), track.strip()
    else:
        artist, track = "AgainstMe", "Vibe With This"

    print(f"query: {artist!r} - {track!r}")
    print("-" * 70)
    t0 = time.perf_counter()
    source_lists, source_artist = await _find_by_artist_and_track(
        artist, track, limit=50
    )
    elapsed = time.perf_counter() - t0
    print(f"elapsed: {elapsed:.2f}s")
    print(f"resolved source_artist: {source_artist!r}")
    print()

    for sl in source_lists:
        print(f"=== {sl.source}  ({len(sl.tracks)} tracks) ===")
        for i, t in enumerate(sl.tracks, 1):
            score_str = f"{t.score:.2f}" if t.score is not None else "  - "
            print(f"  {i:2}. score={score_str}  {t.artist} — {t.title}")
        print()


if __name__ == "__main__":
    asyncio.run(main())
