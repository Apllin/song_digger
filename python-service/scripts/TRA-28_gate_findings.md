# TRA-28 Sub-task 0 — Troi lb-radio viability gate

**Outcome: PASS** (2026-06-12). Integration proceeded on this basis.

Reproduce with [`troi_viability_spike.py`](./troi_viability_spike.py):

```
.venv/bin/python scripts/troi_viability_spike.py
```

## What was tested

`troi==2026.3.10.0`, lb-radio patch in **Global mode** (recording MBIDs only),
run as an in-process library. Probes:

| mode | prompt | result |
| ---- | ------ | ------ |
| easy | `artist:(radiohead) tag:(trip hop)` (ticket's known-good seed) | 50 MBIDs |
| easy | `tag:(techno)` | 50 MBIDs |
| hard | `tag:(hypnotic techno)` | 50 MBIDs |
| easy | `artist:(Oscar Mulero)` | 42 MBIDs |
| hard | `tag:(dub techno)` | on-target (Pendle Coven, DeepChord, Skruff) |

## Findings

- Library imports and runs without errors; ListenBrainz datasets reachable; no
  transient 503s observed across the run (retry-over-window logic is in the
  script and in the adapter's circuit breaker if they recur).
- **Target-genre coverage is real**, not just mainstream: hard mode on
  hypnotic/dub techno and underground seeds (Oscar Mulero) returns genuinely
  on-target results — this was the gate's main risk.
- Each recording carries `mbid`, `name`, and `artist_credit.name` — enough to
  surface as a MusicBrainz recording URL for the downstream Discogs resolver.
- Global mode needs no auth token.

## Notes carried into the integration

- Troi is pinned hard in `requirements.txt` — its tag element is documented as
  in-flux; a bump must be re-validated against `app/services/troi_tags.py`.
- Licensing: MetaBrainz data is free for **non-commercial** use only. The
  adapter ships **feature-flagged off** (`TROI_ENABLED=false`); confirm the
  commercial posture before enabling in a paid deployment. (Related: the Stripe
  / source-legality thread.)
