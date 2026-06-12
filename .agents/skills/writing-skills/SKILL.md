---
name: writing-skills
description: Use when creating a new skill or editing an existing skill under .agents/skills/, or before relying on a skill you just wrote. Covers frontmatter, description/trigger wording (CSO), naming, file layout, token efficiency, and validating a skill against baseline behavior.
license: MIT
---

# Writing Skills

## Overview

A skill is a reusable reference guide for a proven technique, pattern, or tool — written so a future agent can find it and apply it correctly.

**Core principle:** if you didn't watch an agent fail _without_ the skill, you don't know whether the skill teaches the right thing. Treat skill-writing like TDD for process documentation: observe the baseline failure, write the minimal skill that fixes it, then close the loopholes you find.

In this repo, skills live in `.agents/skills/<name>/SKILL.md` (`.claude/skills` is a symlink to it). Project-specific facts go in `CLAUDE.md`, not in a skill.

## When to Create a Skill

**Create when:**

- The technique wasn't intuitively obvious.
- You'd reference it again across tasks.
- It encodes a hard-won lesson (e.g. `prisma-transaction`'s 30s timeout, `python-adapter-pattern`'s soft-degradation).

**Don't create for:**

- One-off solutions or a narrative of how you fixed something once.
- Standard practices documented elsewhere.
- Project conventions that belong in `CLAUDE.md`.
- Anything mechanically enforceable with a linter/validation — automate it instead; reserve skills for judgment calls.

## SKILL.md Structure

Frontmatter (YAML), matching the skills already in this repo:

- `name` — letters, numbers, hyphens only.
- `description` — third person, **triggering conditions only** (see CSO below).
- `license` — optional (`MIT` on ported skills).

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
Symptoms and use cases. When NOT to use.

## Core Pattern
Before/after comparison for techniques.

## Quick Reference
Table or bullets for scanning.

## Common Mistakes
What goes wrong + the fix.
```

## Claude Search Optimization (CSO)

A future agent reads only the `description` to decide whether to load the skill. This is the highest-leverage part.

**The description = WHEN to use, NOT what the skill does.**

If the description summarizes the workflow, the agent tends to follow that summary _instead of reading the skill body_. Real example: a description saying "code review between tasks" caused agents to do ONE review even though the skill specified TWO. Changing it to a pure trigger ("Use when executing implementation plans with independent tasks") made them read the body and follow it.

```yaml
# BAD — summarizes the workflow; agent follows this and skips the body
description: Use when executing plans - dispatches subagent per task with review between tasks

# BAD — first person / too abstract
description: I can help with async tests when they're flaky

# GOOD — triggering conditions only
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

Other CSO rules:

- Start with "Use when…".
- Describe the _problem_ (race condition, hanging request), not a language-specific token (`setTimeout`). Keep triggers technology-agnostic unless the skill itself is technology-specific — then say so explicitly.
- Pack in searchable keywords: error strings (`P2028`, "ENOTEMPTY"), symptoms ("flaky", "hanging"), synonyms ("timeout/hang/freeze"), tool/library names.
- Name by what you DO: `condition-based-waiting` > `async-test-helpers`; `root-cause-tracing` > `debugging-techniques`. Gerunds work well for processes.

## File Layout

Keep inline: principles, concepts, code patterns under ~50 lines.

Split into a separate file only for:

1. **Heavy reference** (100+ lines) — large API/syntax docs.
2. **Reusable tools** — scripts, templates, working helpers to adapt.

```
self-contained/        skill-with-tool/          heavy-reference/
  SKILL.md               SKILL.md                   SKILL.md
                         example.ts                 api-reference.md
                                                     scripts/
```

Most skills here are self-contained (`refactor`, `prisma-transaction`); `code` and `turborepo` use the heavy-reference layout.

## Token Efficiency

Skills load into context, so be concise. Aim for <500 words for a normal skill; tighter for anything frequently loaded.

- Move flag-level detail to `--help` output, link to it instead of duplicating.
- Cross-reference other skills by name instead of repeating their content. Do **not** use `@file` links — that force-loads the file and burns context before it's needed.
- One excellent, runnable example beats five mediocre ones in five languages. You're good at porting — one is enough.

## Cross-Referencing

Reference another skill by name with an explicit marker:

- Good: `**REQUIRED:** see the systematic-debugging skill`
- Bad: `@.agents/skills/systematic-debugging/SKILL.md` (force-loads, burns context)

## Validate Before Relying On It (TDD for Skills)

Don't ship a skill you haven't watched work. The lightweight loop:

1. **RED — baseline.** Give the bare task to a fresh agent (e.g. an `Agent` subagent) _without_ the skill. Record exactly what it does wrong and the rationalizations it uses, verbatim.
2. **GREEN — write minimal skill.** Address those specific failures. Don't pad for hypothetical cases.
3. **REFACTOR — close loopholes.** Re-run with the skill. Found a new rationalization? Add an explicit counter. Repeat until it complies.

For discipline-enforcing skills (rules that must hold under pressure), this matters most — collect the excuses agents make into a rationalization table and a "Red Flags — STOP" list, the way `systematic-debugging` does. For technique/reference skills, instead test that an agent can _apply_ or _retrieve_ correctly from the skill alone.

## Anti-Patterns

| Anti-pattern | Why it's bad |
| --- | --- |
| Narrative ("In the 2026-05 session we found…") | Too specific, not reusable. State the technique. |
| Multi-language dilution (`example.js`, `.py`, `.go`) | Mediocre and high-maintenance. One great example. |
| Code inside flowcharts | Can't copy-paste, hard to read. Use code blocks. |
| Generic labels (`step1`, `helper2`) | Labels should carry meaning. |
| Description that summarizes the workflow | Agent follows the summary and skips the body. |
| Frontmatter `name` with spaces/special chars | Breaks loading. Hyphens only. |

## The Bottom Line

Write the description as a pure trigger, keep the body lean and self-contained, and watch an agent succeed with it before you trust it. A skill you didn't validate is documentation you're hoping is correct.

---

_Adapted from [obra/superpowers](https://github.com/obra/superpowers) (MIT), trimmed and retargeted to this monorepo._
