# 0010 — Label graph for stylistic proximity

**Date:** 2025-01-XX
**Status:** Deferred (2026-05-03 — no `LabelGraphEdge` Postgres model, no `build_label_graph.py` script. scoring.md confirms label-graph proximity bonus is not applied. May revisit when Stage D/E label features are scoped).

**Context:**
For techno specifically, the record label is a strong stylistic signal.
Pole Group, Token, Tresor, Mord all release music with strong sonic
identity — knowing a track is on Pole Group already places it within a
narrow stylistic window.

Exact-label-match (instruction 03) captures this for same-label tracks but
misses sister-label relationships. An Ancient Methods track on Token is
stylistically very close to a Mulero track on Pole Group, but exact-match
gives them 0.

We want partial credit for "near" labels.

**Decision:**
Build a label-similarity graph from Discogs artist data. Two labels are
linked with weight equal to Jaccard similarity of their artist sets:
`|artists(A) ∩ artists(B)| / |artists(A) ∪ artists(B)|`.

Graph stored in Postgres `LabelGraphEdge` table, rebuilt weekly via
`python-service/scripts/build_label_graph.py`. Seed list of ~30-50 labels of
interest, expandable.

At query time, label-proximity score is a fast Postgres lookup with
in-memory cache.

**Consequences:**
- Positive: catches sister-label relationships that exact-match misses.
- Positive: graph is small (1k-2k edges) — keeps in memory cheaply.
- Positive: Jaccard is parameter-free — no tuning required.
- Negative: Discogs label data has gaps (small labels, recent releases).
  Some genuinely-similar labels won't connect.
- Negative: requires periodic rebuild. Stale graph degrades signal silently.
  Add monitoring on edge `computedAt`.
- Negative: only useful for labels in the seed list. Cold-start labels
  contribute nothing to label-graph score (fall back to exact-match only).

**Alternatives considered:**
- Co-occurrence in DJ sets between labels — rejected, weaker signal than
  shared artists; co-occurrence is at track level not label level
- ML embedding of labels (word2vec on release descriptions, etc) — rejected,
  overkill and noisy at this scale
- Manual curation of "label clusters" — rejected, doesn't scale, biased to
  curator's knowledge gaps

**Revisit when:**
- The seed label list grows beyond ~100 — Jaccard's quadratic edge count may
  start to matter (still tiny: 100^2 = 10k edges, fine)
- We add Bandcamp catalog ingestion which would supplement Discogs gaps
- A user adds a track from a label not in the graph and reports the absence
  of label-graph contribution
