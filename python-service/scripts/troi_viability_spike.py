"""TRA-28 Sub-task 0 — Troi lb-radio viability gate.

Runs the lb-radio patch in Global mode against known-good seeds and reports
whether it returns recording MBIDs. Retries on transient 503s (LB Radio
backend is known to be intermittently down) before judging non-viable.

Usage: .venv/bin/python scripts/troi_viability_spike.py
"""
import sys
import time

from troi.patches.lb_radio import LBRadioPatch

# (mode, prompt) probes. First is the ticket's documented known-good seed.
PROBES = [
    ("easy", 'artist:(radiohead) tag:(trip hop)'),
    ("easy", 'tag:(techno)'),
    ("hard", 'tag:(hypnotic techno)'),
    ("easy", 'artist:(Oscar Mulero)'),
]

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 5


def run_probe(mode: str, prompt: str) -> tuple[bool, str, int]:
    """Return (ok, detail, n_recordings)."""
    patch = LBRadioPatch({"mode": mode, "prompt": prompt, "min_recordings": None, "quiet": True})
    playlist = patch.generate_playlist()
    if playlist is None or not playlist.playlists:
        return False, "no playlist produced", 0
    recs = playlist.playlists[0].recordings
    mbids = [r.mbid for r in recs if getattr(r, "mbid", None)]
    return (len(mbids) > 0), f"{len(mbids)} mbids / {len(recs)} recordings", len(mbids)


def main() -> int:
    print(f"troi version: {__import__('troi').__version__ if hasattr(__import__('troi'), '__version__') else 'unknown'}")
    any_ok = False
    for mode, prompt in PROBES:
        print(f"\n=== PROBE mode={mode} prompt={prompt!r} ===")
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                ok, detail, n = run_probe(mode, prompt)
                print(f"  attempt {attempt}: {'OK' if ok else 'EMPTY'} — {detail}")
                if ok:
                    any_ok = True
                    sample = []
                    # re-run capture of a few sample mbids for the record
                    break
                # empty but no exception — could be sparse genre, try again briefly
            except Exception as e:
                msg = str(e)
                transient = "503" in msg or "temporarily unavailable" in msg.lower() or "timed out" in msg.lower()
                print(f"  attempt {attempt}: ERROR ({'transient' if transient else 'hard'}) — {msg[:200]}")
                if not transient:
                    break
            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_SECONDS)
    print(f"\n=== GATE RESULT: {'PASS (at least one probe returned MBIDs)' if any_ok else 'FAIL/INCONCLUSIVE'} ===")
    return 0 if any_ok else 1


if __name__ == "__main__":
    sys.exit(main())
