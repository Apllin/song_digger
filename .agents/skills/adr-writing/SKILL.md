---
name: adr-writing
description: Use this skill when writing or updating an Architecture Decision Record (ADR) in web/docs/decisions/. Triggered when introducing a non-trivial design choice — new ranking signal, changed source-fusion approach, removed feature, infrastructure decision, scoring algorithm change. Existing ADRs use a strict structure (Status / Context / Decision / Consequences); new ADRs must match. Encodes the rule that ADRs document decisions made, not plans to be made.
---

# ADR writing

ADRs in `web/docs/decisions/` are the canonical record of architectural decisions. They are NOT design proposals, NOT plans, NOT speculation. They document choices that have been made and the reasoning at the time.

## When to use this skill

- Introducing a new ranking signal (label graph, year proximity, energy scoring)
- Removing a feature (the way ADR-0003 documented removing the weighted-sum scorer)
- Adopting a new external dependency or replacing one (Last.fm vs Discogs as tag source)
- Changing fusion math (the original RRF adoption was ADR-0003)
- Establishing a process or workflow rule (eval as merge gate is ADR-0009)
- Marking a previously-active decision as superseded

## When NOT to use this skill

- Bug fixes, refactors, dependency upgrades — these go in commit messages
- Tweaking a calibration constant — the `scoring.md` table is the source of truth, not an ADR
- Documenting work-in-progress plans — use `song-digger-stages/` or commit messages
- Capturing options under consideration — that's a design doc, not an ADR

If you find yourself writing "we will" or "the proposed approach is", you're not writing an ADR. ADRs use past tense for decisions: "we adopted RRF", "we removed the weighted-sum scorer".

## File naming

`web/docs/decisions/NNNN-kebab-case-title.md`

The number is the next sequential integer (ADR-0011 follows ADR-0010). Don't skip numbers, don't reuse them, don't insert. Look at the directory listing to find the next number.

Title is short — 3-6 words capturing the decision. Examples:
- `0003-rrf-fusion.md` — good
- `0008-tier-based-fallback.md` — good
- `0011-cosine-down-fallback-strategy.md` — borderline long, still fine
- `0012-decided-to-use-different-approach-for-similarity.md` — too long

## Required structure

Every ADR has these four sections in this order. Don't reorder. Don't omit. Don't add extra top-level sections.

```markdown
# ADR-NNNN: <title>

## Status

<Active | Superseded by ADR-NNNN | Deferred | Abandoned>
<date in YYYY-MM-DD>

## Context

<Why this decision was needed. What problem prompted it. What was the
state of the system before. 2-5 paragraphs.>

## Decision

<What was decided. Specific. Stated as facts not options. If alternatives
were considered, list them and explain why they were rejected. 2-5
paragraphs or a bulleted list.>

## Consequences

<What changes as a result. Both positive and negative. What this
forecloses, what this enables, what becomes harder. Be honest about
tradeoffs. 2-4 paragraphs.>
```

## Writing each section

### Status

Single line. Active means the decision is in force. Superseded means another ADR replaced it (link the replacing ADR). Deferred means we decided to revisit later (rare; usually means "we wrote this up but aren't committing yet"). Abandoned means we tried the decision and reverted.

Date is when the status was set, not when the file was edited.

### Context

The "why we needed to decide" section. Should make sense to a reader 6 months later who has forgotten the project state.

Good context:
- "Cosine.club's audio embedding similarity is the strongest single signal but the API is occasionally unavailable for hours at a time."

Bad context:
- "We were thinking about how to make the system better." (no specifics)
- "The user might benefit from..." (speculation, not state)
- "Industry best practice is..." (irrelevant unless we directly applied it)

### Decision

The "what we did" section. Concrete and minimal.

Good decision:
- "Adopted Reciprocal Rank Fusion (RRF) with k=60 as the merge strategy across all source lists. Each source produces a ranked list; final score is `Σ 1/(60 + rank_i)` summed over sources where the candidate appears."
- "Removed the previous weighted-sum scorer (`audio*0.5 + tag*0.3 + bpm*0.2`)."

Bad decision:
- "We will explore RRF and other fusion methods." (no decision made)
- "RRF or weighted-sum could work; we chose RRF." (waffling)

If alternatives were considered, write a short paragraph: "We considered weighted-sum tuning per source pair, but rejected it because [specific reasons]." Don't list alternatives we never seriously considered.

### Consequences

Honest accounting.

Positive: what becomes possible or simpler. ("Sources can be added or removed without re-tuning weights — RRF math is monotone in source count.")

Negative: what we lose or what becomes harder. ("Cosine's high-confidence audio score becomes equivalent to a low-confidence Bandcamp recommendation if both are at rank 1. Strong signals are democratized.")

Don't lie about tradeoffs to make the decision look better. The point of an ADR is the reader trusts it.

## Conflict resolution with `scoring.md`

Per the rule established in `web/docs/scoring.md`:

> Where this document and an ADR disagree, this document describes what runs; the ADR may describe a deferred or abandoned plan.

This means:

- ADRs are NOT updated when the implementation drifts. ADR-0005 still says "key as soft signal" even though the code has no key scoring; the ADR documents the intent at the time.
- New ADRs may explicitly supersede old ones. When they do, the old ADR's Status is updated to "Superseded by ADR-NNNN" and that's all — the old content stays.
- If you find a contradiction between code and an old ADR while doing other work, do NOT silently update the ADR. Either write a superseding ADR or leave the contradiction visible.

## Common mistakes

- **Writing an ADR before the decision is made.** ADRs document, they don't propose. If you're not sure which way to go, write a design doc in `song-digger-stages/` or a GitHub issue, not an ADR.
- **Updating an old ADR to match new behavior.** The audit trail is more valuable than the consistency. Old ADRs are historical record.
- **Treating ADRs as comprehensive design specs.** They document one decision each. Multi-decision changes are multiple ADRs.
- **Skipping numbers.** Causes confusion later. Always use the next sequential.
- **Vague titles.** "Improvements to ranking" is bad. "Adopted RRF for source-list fusion" is good.
- **Forgetting cross-references.** When ADR-0008 (tier-based fallback) is superseded by a simpler approach in ADR-0011, both files should mention each other.

## Example ADRs in this repo to use as reference

Read these to internalize tone before writing a new one:

- `web/docs/decisions/0002-source-artist-filter.md` — small focused decision
- `web/docs/decisions/0003-rrf-fusion.md` — algorithmic choice with rejected alternatives
- `web/docs/decisions/0008-tier-based-fallback.md` — currently a deferred plan; demonstrates the "Status: deferred" usage
- `web/docs/decisions/0009-eval-as-merge-gate.md` — process/workflow ADR

When unsure about format details, mirror the closest existing ADR by topic.
