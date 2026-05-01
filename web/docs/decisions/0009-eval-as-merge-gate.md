# 0009 — Eval harness as merge gate for scoring changes

**Date:** 2025-01-XX
**Status:** Accepted

**Context:**
Recommendation systems suffer from "subjectively better" syndrome: every
change feels like an improvement to the person who made it. Without a
measurement gate, scoring drifts based on whoever's most recent intuition
ran the last edit. Worse, improvements on one query class regress others
silently.

The eval harness (`python-service/eval/`) measures nDCG@10 over a labeled
golden set. We need to actually USE it as a check, not just have it sit
there.

**Decision:**
Any PR that touches scoring/fusion/adapter logic that affects ranking MUST
attach an eval diff vs current baseline in the PR description. PRs without
this diff do not get reviewed.

Concretely:
- Before starting work: run eval, save `runs/<feature-name>-baseline.json`
- After implementing: run eval again, compare with baseline
- Paste the diff section ("--- DIFF vs baseline ---") into PR description
- Per-seed regressions > 0.05 must be either fixed or explicitly justified
  (rare: e.g. "this seed is now unreachable because we removed a stale
  dependency, accept regression")

When merge is approved and main is updated, copy the new run to
`runs/baseline.json` so subsequent PRs measure against current state.

**Consequences:**
- Positive: ranking quality has a measurable trajectory over time.
- Positive: catches multi-source-agreement regressions that humans miss.
- Positive: lowers the cost of skeptical questions in code review ("does
  this actually help?" — answer: "look at the diff").
- Negative: eval takes ~30s for 30 seeds. Adds friction for small changes.
  Worth it.
- Negative: golden set quality directly determines gate quality. Garbage-in,
  garbage-gate. The `extend-eval-set` skill is the discipline that keeps
  the set healthy.

**Alternatives considered:**
- Manual review of "feels better" without metric — rejected, the literal
  problem we're solving
- Optional eval diff (encouraged but not required) — rejected, skipped
  by default, doesn't enforce anything
- Auto-block via CI when nDCG drops — possible future but premature; humans
  understand "this regression is expected because X" better than rules

**Revisit when:**
- Eval set hits 100+ seeds (current 30 is the lower bound for stability)
- Per-seed metric variance becomes too noisy for the gate to be useful (then
  we need to look at confidence intervals, not point estimates)
