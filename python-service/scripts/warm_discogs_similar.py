"""Offline warmer for the Discogs collaborative source.

Runs the slow build (seed → Have/Want collectors → on-genre collection releases)
and writes the result to the `discogs_similar` cache, which the /similar hot path
reads. Needs DISCOGS_TOKEN, DATABASE_URL, and DISCOGS_STATS_UNBLOCKER_URL set.

    python -m scripts.warm_discogs_similar "Joe Milli - Repetitions EP" [limit]

Pass one query per invocation (or loop over a seed list in a shell). Keep the
cadence well under the Discogs 60 req/min limit.
"""
import asyncio
import sys

from app.adapters.discogs import DiscogsAdapter


async def main() -> None:
    if len(sys.argv) < 2:
        print('usage: python -m scripts.warm_discogs_similar "Artist - Track" [limit]')
        raise SystemExit(2)
    query = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 9

    adapter = DiscogsAdapter()
    try:
        tracks = await adapter.build_collaborative(query, limit)
    finally:
        await adapter.aclose()

    print(f"warmed {len(tracks)} track(s) for {query!r}")
    for t in tracks:
        print(f"  - {t.artist} — {t.title}  [{t.genre or '?'}]  {t.sourceUrl}")


if __name__ == "__main__":
    asyncio.run(main())
