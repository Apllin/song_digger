# Eval harness

Measurement-only test harness for `/similar` quality. Hits the production
endpoint with labeled seed queries, reports nDCG@10.

## Setup

1. Put `golden-set.json` in this directory (template is provided).
2. Fill in real seeds — start with at least 20 before relying on the metric.
3. Run with `python-service/.venv/bin/python -m eval.runner`.

## Files

- `golden-set.json` — labeled seed queries
- `runner.py` — executes seeds against `/similar`, computes nDCG, writes results
- `metrics.py` — nDCG@10 implementation
- `runs/` — per-run JSON output (gitignored except for `baseline.json`)

## Running

The python-service must be running locally first:

```bash
# In one terminal:
cd python-service && .venv/bin/uvicorn app.main:app --reload

# In another:
.venv/bin/python -m eval.runner
.venv/bin/python -m eval.runner --filter mulero
.venv/bin/python -m eval.runner --baseline runs/baseline.json
```

## Interpreting output

- **Per-seed nDCG**: 1.0 = ideal ordering, 0.0 = all results are false friends
  ranked highly. Anything > 0.7 is good for a balanced seed; > 0.85 is great.
- **Average across seeds**: trend matters more than absolute number. Watch
  direction over time.
- **`rel=N fp=M`** in notes column: count of relevant and false-friend tracks
  in the top-10. `fp=0` is the goal — false friends in top-10 means the
  scoring is confused about subgenre boundaries.
- **Diff vs baseline**: `↑` and `↓` flag changes >0.005. Per-seed regressions
  >0.05 should block a merge until investigated.

## When to update

- **Code change to scoring or fusion**: run before, run after, attach diff
  to PR.
- **Seed expansion** (via `extend-eval-set` skill): rerun to get updated
  baseline. Note that adding seeds shifts the average — that's expected, not
  a regression.
- **Adapter change** (new source, modified adapter): same as scoring change,
  diff required.

## Why neutral grade for unmarked

See `metrics.py` docstring. Short version: marking unknown tracks as 0 punishes
the system for finding good music you didn't think of. Neutral=1 is honest
about label-set incompleteness.

## Calibration check

Before trusting the harness:

```bash
.venv/bin/python -m eval.runner --out /tmp/run-a.json
.venv/bin/python -m eval.runner --out /tmp/run-b.json --baseline /tmp/run-a.json
```

Two consecutive runs should diff by < 0.02 per seed. Larger spread means
non-determinism somewhere (external API ordering, race conditions). Investigate
before treating the metric as authoritative.

## Updating baseline

After a known-good change lands and you want it as the new reference:

```bash
cp runs/<latest-good-run>.json runs/baseline.json
git add runs/baseline.json
git commit -m "eval: update baseline after <change>"
```

The `runs/baseline.json` file IS committed. Other run files are gitignored.
