---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior in web or python-service, before proposing fixes. Symptoms include flaky tests, hanging requests, wrong search results, and "it works locally but not in CI". Enforces root-cause-first investigation over guess-and-check patching.
license: MIT
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue: test failures, production bugs, unexpected behavior, performance problems, build failures, cross-service integration issues (web ↔ python-service ↔ Postgres).

**Use this ESPECIALLY when:**

- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- The previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**

- The issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read error messages carefully** — don't skip errors/warnings; read stack traces completely; note line numbers, file paths, error codes (e.g. Prisma `P2028`, httpx timeouts).
2. **Reproduce consistently** — can you trigger it reliably? Exact steps? Every time? If not reproducible, gather more data, don't guess.
3. **Check recent changes** — `git diff`, recent commits, new dependencies, config/env differences, a bumped `SEARCH_CACHE_VERSION`.
4. **Gather evidence across component boundaries** — this codebase spans Next API route → python-service `/similar` → source adapter → Postgres. Before proposing fixes, add diagnostic logging at each boundary and run once to see WHERE it breaks:
   - Log what data enters each component and what exits it.
   - Verify env/config propagation (`PYTHON_SERVICE_URL`, API keys, `DATABASE_URL`).

   ```
   # web route: log payload sent to python-service and the raw response
   # python /similar: log query in, adapter results out (per source)
   # adapter: log the upstream HTTP status + item count (soft-degradation returns [])
   # saveTracks: log chunk sizes and any transaction error
   ```

   This reveals which layer fails (e.g. adapter returned `[]` because the API key was unset → degradation, not a bug).
5. **Trace data flow backward** — when the error is deep in the call stack, find where the bad value originates, what passed it in, and keep tracing up to the source. Fix at the source, not at the symptom.

### Phase 2: Pattern Analysis

1. **Find working examples** — locate similar working code in the same codebase. Another adapter that works? Another route that saves tracks fine?
2. **Compare against references** — if following a pattern (e.g. `python-adapter-pattern`, `prisma-transaction`), read it completely. Don't skim.
3. **Identify differences** — list every difference between working and broken, however small. Don't assume "that can't matter".
4. **Understand dependencies** — what config, env, and assumptions does the broken path rely on?

### Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** — state it: "I think X is the root cause because Y." Be specific.
2. **Test minimally** — smallest possible change, one variable at a time. Don't fix multiple things at once.
3. **Verify before continuing** — worked → Phase 4. Didn't work → form a NEW hypothesis, don't pile fixes on top.
4. **When you don't know** — say "I don't understand X." Don't pretend. Research more or ask.

### Phase 4: Implementation

1. **Create a failing test first** — simplest reproduction. `pytest` for python-service, `vitest` for web. A one-off script is fine if no framework fits. You must have it before fixing.
2. **Implement a single fix** — address the root cause. ONE change. No "while I'm here" improvements, no bundled refactoring.
3. **Verify the fix** — test passes now? No other tests broken (`pnpm test`)? Issue actually resolved?
4. **If the fix doesn't work** — STOP. Count attempts. If < 3, return to Phase 1 with the new information. **If ≥ 3, stop and question the architecture (step 5).**
5. **If 3+ fixes failed: question the architecture** — when each fix reveals new coupling/shared state elsewhere, or each fix needs "massive refactoring", the pattern itself may be wrong. Discuss with the user before attempting more fixes. This is not a failed hypothesis — it's a wrong architecture.

## Red Flags — STOP and Follow Process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- "One more fix attempt" (when you've already tried 2+)
- Each fix reveals a new problem in a different place

**All of these mean: STOP. Return to Phase 1.** If 3+ fixes failed, question the architecture (Phase 4.5).

## Signals From the User That You're Off Track

- "Is that not happening?" — you assumed without verifying.
- "Will it show us…?" — you should have added evidence gathering.
- "Stop guessing" — you're proposing fixes without understanding.
- "We're stuck?" (frustrated) — your approach isn't working.

**When you see these: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse | Reality |
| --- | --- |
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I'll write the test after confirming the fix" | Untested fixes don't stick. A failing test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question the pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
| --- | --- | --- |
| **1. Root Cause** | Read errors, reproduce, check changes, log boundaries | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify the differences |
| **3. Hypothesis** | Form one theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Failing test, single fix, verify | Bug resolved, tests pass |

## When Process Reveals "No Root Cause"

If investigation shows the issue is genuinely environmental, timing-dependent, or upstream/external:

1. You've completed the process.
2. Document what you investigated.
3. Implement appropriate handling (retry, timeout, clear error, soft-degradation).
4. Add monitoring/logging for future investigation.

But: most "no root cause" cases are incomplete investigation.

---

_Adapted from [obra/superpowers](https://github.com/obra/superpowers) (MIT), trimmed and retargeted to this monorepo._
