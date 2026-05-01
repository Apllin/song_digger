"""
Eval harness runner — measures search quality against a labeled golden set.

Usage:
    .venv/bin/python -m eval.runner
    .venv/bin/python -m eval.runner --filter mulero
    .venv/bin/python -m eval.runner --baseline eval/runs/2025-01-15.json
    .venv/bin/python -m eval.runner --service-url http://localhost:8000

Output:
    - Per-seed nDCG@10 table on stdout
    - Overall average
    - JSON written to eval/runs/<timestamp>.json
    - When --baseline is provided, prints diff vs that file
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from eval.metrics import GradeLabel, ndcg_at_10
# Reuse the same normalisation as the production code so the eval matcher
# behaves identically to dedup logic.
from app.api.routes.similar import _normalize_title, _same_artist


# ── Configuration ──────────────────────────────────────────────────────────────

EVAL_DIR = Path(__file__).parent
GOLDEN_SET_PATH = EVAL_DIR / "golden-set.json"
RUNS_DIR = EVAL_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)


# ── Match logic ────────────────────────────────────────────────────────────────

def _matches(result_artist: str, result_title: str,
             label_query: str) -> bool:
    """A result matches a label entry if artist is the same and title overlaps."""
    if " - " not in label_query:
        return False
    label_artist, label_title = [s.strip() for s in label_query.split(" - ", 1)]
    if not _same_artist(result_artist, label_artist):
        return False
    a = _normalize_title(result_title).lower()
    b = _normalize_title(label_title).lower()
    return a == b or a in b or b in a


def _classify(result: dict, seed: dict) -> GradeLabel:
    """Map a result track to a relevance grade based on the seed's labels."""
    result_artist = result.get("artist", "")
    result_title = result.get("title", "")

    for r in seed.get("relevant", []):
        if _matches(result_artist, result_title, r["query"]):
            return "relevant"
    for f in seed.get("false_friends", []):
        if _matches(result_artist, result_title, f["query"]):
            return "false_friend"
    return "unmarked"


# ── Search invocation ──────────────────────────────────────────────────────────

async def _run_seed(client: httpx.AsyncClient, service_url: str, seed: dict) -> dict:
    """Hit the production /similar endpoint with this seed's query, classify results."""
    query = seed["query"]
    if " - " not in query:
        artist, track = query, None
    else:
        artist, track = [s.strip() for s in query.split(" - ", 1)]

    body = {
        "input": query,
        "artist": artist,
        "track": track,
        "sources": ["youtube_music", "cosine_club"],
        "limit_per_source": 40,
    }

    try:
        resp = await client.post(f"{service_url}/similar", json=body, timeout=120)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {
            "id": seed["id"],
            "query": query,
            "error": str(e),
            "ndcg": 0.0,
            "grades": [],
        }

    tracks = data.get("tracks", [])[:10]
    grades: list[GradeLabel] = [_classify(t, seed) for t in tracks]
    return {
        "id": seed["id"],
        "query": query,
        "ndcg": ndcg_at_10(grades),
        "grades": grades,
        "results": [
            {"artist": t.get("artist"), "title": t.get("title"),
             "source": t.get("source"), "grade": grades[i] if i < len(grades) else None}
            for i, t in enumerate(tracks)
        ],
        "tier": data.get("tier"),
        "tier_label": data.get("tier_label"),
    }


# ── Output ─────────────────────────────────────────────────────────────────────

def _print_table(results: list[dict]) -> None:
    print(f"{'seed':<30} {'tier':>6} {'nDCG@10':>10}  notes")
    print("-" * 80)
    for r in results:
        if "error" in r:
            print(f"{r['id'][:30]:<30} {'-':>6} {'ERROR':>10}  {r['error'][:40]}")
            continue
        relevant_count = sum(1 for g in r['grades'] if g == 'relevant')
        false_count = sum(1 for g in r['grades'] if g == 'false_friend')
        notes = f"rel={relevant_count} fp={false_count}"
        tier = r.get('tier', '-')
        print(f"{r['id'][:30]:<30} {tier:>6} {r['ndcg']:>10.4f}  {notes}")
    print("-" * 80)
    valid = [r['ndcg'] for r in results if 'error' not in r]
    avg = sum(valid) / len(valid) if valid else 0.0
    print(f"{'AVERAGE':<30} {'':>6} {avg:>10.4f}  ({len(valid)} seeds)")


def _print_diff(current: list[dict], baseline: list[dict]) -> None:
    """Compare two run result lists, print per-seed delta."""
    by_id = {r["id"]: r for r in baseline}
    deltas = []
    print("\n--- DIFF vs baseline ---")
    print(f"{'seed':<30} {'baseline':>10} {'current':>10} {'delta':>8}")
    for r in current:
        b = by_id.get(r["id"])
        if not b:
            print(f"{r['id'][:30]:<30} {'NEW':>10} {r['ndcg']:>10.4f}  +{r['ndcg']:.4f}")
            continue
        if "error" in r or "error" in b:
            print(f"{r['id'][:30]:<30} {'ERR':>10} {'ERR':>10}")
            continue
        delta = r["ndcg"] - b["ndcg"]
        deltas.append(delta)
        marker = "  " if abs(delta) < 0.005 else ("↑" if delta > 0 else "↓")
        print(f"{r['id'][:30]:<30} {b['ndcg']:>10.4f} {r['ndcg']:>10.4f} {delta:>+8.4f} {marker}")
    if deltas:
        print(f"\nMean delta: {sum(deltas)/len(deltas):+.4f}")
        regressions = [d for d in deltas if d < -0.05]
        if regressions:
            print(f"⚠ {len(regressions)} seed(s) regressed by >0.05 — investigate before merge")


# ── Main ───────────────────────────────────────────────────────────────────────

async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-url", default="http://localhost:8000")
    parser.add_argument("--filter", help="substring match against seed id")
    parser.add_argument("--baseline", help="path to a previous run JSON for diff")
    parser.add_argument("--out", help="output path for this run (default: timestamped)")
    args = parser.parse_args()

    if not GOLDEN_SET_PATH.exists():
        print(f"Golden set not found at {GOLDEN_SET_PATH}", file=sys.stderr)
        return 1

    golden = json.loads(GOLDEN_SET_PATH.read_text())
    seeds = [s for s in golden["seeds"] if not s.get("id", "").startswith("_PLACEHOLDER")]
    if args.filter:
        seeds = [s for s in seeds if args.filter.lower() in s.get("id", "").lower()]
    if not seeds:
        print("No seeds matched filter (or all seeds are placeholders)", file=sys.stderr)
        return 1

    print(f"Running {len(seeds)} seeds against {args.service_url}")

    async with httpx.AsyncClient() as client:
        tasks = [_run_seed(client, args.service_url, s) for s in seeds]
        results = await asyncio.gather(*tasks)

    _print_table(results)

    out_path = Path(args.out) if args.out else (
        RUNS_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    )
    out_path.write_text(json.dumps({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service_url": args.service_url,
        "seed_count": len(results),
        "results": results,
    }, indent=2))
    print(f"\nResults written to {out_path}")

    if args.baseline:
        baseline_data = json.loads(Path(args.baseline).read_text())
        _print_diff(results, baseline_data["results"])

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
