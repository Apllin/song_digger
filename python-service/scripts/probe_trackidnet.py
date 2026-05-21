"""One-off: run TrackidnetAdapter against a fixed query and dump results."""
import asyncio
import sys

from app.adapters.trackidnet import TrackidnetAdapter


async def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else "AgainstMe - Vibe With This"
    adapter = TrackidnetAdapter()
    results = await adapter.find_similar(query, limit=50)
    print(f"query: {query!r}")
    print(f"got {len(results)} results")
    print("-" * 70)
    for i, r in enumerate(results, 1):
        print(f"{i:2}. score={r.score:>4.0f}  {r.artist} — {r.title}")
        print(f"     {r.sourceUrl}")


if __name__ == "__main__":
    asyncio.run(main())
