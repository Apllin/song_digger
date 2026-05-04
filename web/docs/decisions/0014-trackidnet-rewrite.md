# 0014 — Trackid.net rewrite as JSON API client (playlists-list flow)

## Status

Accepted
2026-05-04

## Context

Trackid.net was added in Stage B as a DJ-set co-occurrence source
alongside the (since-removed, see ADR-0012) 1001tracklists adapter.
The Stage B implementation was an HTML scraper targeting CSS selectors
copied from the B3 spec as plausible examples; the selectors were
never validated against the live DOM. The adapter shipped flag-disabled
(`settings.trackidnet_enabled = False`) with TODO comments instructing
whoever flipped the flag to re-verify the selectors first.

When verification was attempted, the discovery was that trackid.net is
a React single-page application: the server returns a JS shell with no
rendered tracklist HTML. There were no selectors to fix because there
was no server-rendered markup to select from. BeautifulSoup against the
SPA shell would never recover data, regardless of how the selectors
were tuned.

The site does, however, expose its data through public JSON endpoints
under `/api/public/...`. **Three** endpoints are sufficient for the
co-occurrence flow:

  - `GET /api/public/musictracks?keywords=<q>` — search/seed lookup
  - `GET /api/public/audiostreams?musicTrackId=<id>` — list ALL
    playlists where a track played (lightweight metadata only, no
    tracklists in the payload)
  - `GET /api/public/audiostreams/<slug>` — full tracklist for one
    playlist with per-track timing

All three return JSON, none requires authentication, none is behind
Cloudflare's challenge layer (verified 2026-05-04 with plain `curl`
returning HTTP 200 on each).

A first iteration of the JSON rewrite (commit 99b97ce) used only the
search and detail endpoints — for each seed it fetched the two
audiostreams referenced by `seed.minCreatedSlug` and
`seed.maxCreatedSlug` (earliest and latest known sets). That capped
each seed's candidate pool at ~20–40 candidates from at most 2
playlists. Discovery of the third endpoint (`/audiostreams?musicTrackId`)
opened up the full set of known playlists for any track, motivating
this rewrite to a wider sampling strategy.

## Decision

Rewrite the adapter to the playlists-list flow and enable it by
default. Per seed:

1. **Search** the `/musictracks` endpoint. Pick the best catalogue
   entry: exact artist match (case-insensitive) with the highest
   `playCount`; fall back to the first entry with `playCount > 0`.
   Capture both the seed `id` (numeric, used by step 2) and `slug`
   (string, used by step 4).
2. **List playlists** for the seed `id` via
   `/audiostreams?musicTrackId=<id>`. The endpoint returns lightweight
   metadata (no tracklist body). Sort defensively by `addedOn`
   descending and take the first `MAX_PLAYLISTS = 15` slugs — fresher
   sets are more representative of the track's current DJ context than
   archived ones from years back.
3. **Fetch each playlist's tracklist** in parallel via
   `/audiostreams/<slug>`, bounded by an
   `asyncio.Semaphore(DETAIL_CONCURRENCY = 5)` so we don't open 15
   sockets at once and look like a scraper from trackid's side.
   Soft-fail per fetch: a 5xx or timeout on one playlist drops only
   that playlist's contribution; the others still aggregate.
4. **Extract a window** around the seed in each tracklist. Pick the
   most recent NON-EMPTY detection process by `endDate` (sets are
   reprocessed; later runs may add or correct tracks, but in the wild
   a reprocess can finish with 0 detected tracks while an earlier
   process holds the real data — strict "latest by endDate" silently
   loses that data). Find the seed by slug; take the `±WINDOW = 5`
   tracks around the first occurrence (5 before, 5 after), excluding
   every instance of the seed slug.
5. **Aggregate** every non-seed track across all extracted windows by
   slug. Co-occurrence count = number of playlists the candidate
   appears in. Sort by count descending, then `referenceCount`
   ascending — globally less-generic tracks win the tiebreak among
   equal counts.
6. **Map to TrackMeta** and return up to `limit`.

### Parameter rationale

- **`MAX_PLAYLISTS = 15`** — `/audiostreams?musicTrackId=` returns
  pageSize=20 in a single request. Using 15 of those (sorted fresh
  first) leaves headroom against the page boundary, gives every seed
  a meaningful sample without paginating, and keeps the per-seed wall-
  clock cost predictable (15 detail fetches at semaphore=5 ≈ 3 batches
  of latency).
- **`WINDOW = 5`** — adjacency context. ±5 tracks around the seed in a
  typical 15–25 track DJ set covers about a third of the set without
  spanning the whole genre arc. Tighter windows (±2) gave too few
  candidates per playlist; wider windows (±10) bled into unrelated set
  segments.
- **`DETAIL_CONCURRENCY = 5`** — politeness / rate-limit insurance.
  Trackid.net has no published rate limit but 5 concurrent fetches is
  a safe upper bound for a public-API consumer; the eval harness
  exercises this 15× per run without trouble.

### Alternatives considered

- **Re-attempt HTML scraping after the SPA shell is rendered** —
  rejected. Would require Playwright or similar, identical to the
  reason 1001tracklists was removed in ADR-0012. Heavy deployment
  cost (Chromium binaries, +200 MB image, security surface) for a
  single source whose JSON API exposes the same data.
- **min/maxCreatedSlug only (the first JSON rewrite, commit 99b97ce)** —
  superseded. Fetching only 2 playlists per seed yielded too few
  candidates (1–10 per seed in measurement) and missed wide swaths
  of co-occurrence context that the broader playlists-list flow now
  surfaces (15–65 per seed in measurement).
- **All-tracks-from-each-playlist (no window)** — considered. Would
  produce 200+ candidates per seed but dilutes the adjacency signal
  that makes DJ-set co-occurrence valuable. The ±5 window keeps the
  signal "tracks the DJ played near this one" rather than "tracks
  the DJ played in the same set", which is qualitatively different.
- **Cache table population (`TrackidCooccurrence`)** — deferred to
  Stage C3. The cache table and helpers exist (Stage B prep, kept
  through the Stage A.5 v2 cleanup); Stage C3 will populate them as
  part of the candidate-features extraction. The live adapter does
  not write to the cache today — every `/similar` call hits trackid
  directly, which is acceptable while seed volume is low.

## Consequences

**Trackid contributes alternative-signal candidates, not similarity
confirmation.** The DJ-set co-occurrence signal is qualitatively
different from what cosine (audio embedding), ytm (radio playlist),
bandcamp (label/catalogue), lastfm (collaborative filtering), and
yandex (similar tracks) produce. As a consequence, trackid candidates
are **typically unique to trackid's source list** — they do not overlap
with the other recommenders. Direct inspection on the eval golden set
showed 0 overlap with cosine/ytm/bandcamp/lastfm/yandex on Mulero,
Linear System, Charlotte, Dozzy seeds.

**Top-10 visibility is structurally limited by single-source RRF math.**
A track that appears only in trackid earns RRF score `1/(60+rank) ≈
0.0164` at best (rank 1). A track that appears in two sources at
moderate ranks earns `1/(60+r1) + 1/(60+r2) ≈ 0.030+`. So trackid-
unique candidates land at ranks 12–38 in the merged output and rarely
crack the top-10 — not because they're irrelevant, but because RRF
fusion rewards multi-source agreement. This is the canonical RRF
tradeoff and is structural, not a bug.

**Eval (nDCG@10) does not reflect trackid's contribution well.**
Pre-rewrite (min/max architecture, flag=True, clean cache) average:
`0.9183` over 15 seeds. Post-rewrite (playlists-list architecture)
average: `0.8989` over 14 seeds (1 hard error from cosine flakiness;
mean Δ `−0.019`, within the ±0.02 inter-run noise band documented in
[eval-gated-changes](../../../.agents/skills/eval-gated-changes/SKILL.md)).
Three seeds drifted >0.05 — `_control_charlotte_apollo` (cosine
adapter dropped a result entirely, unrelated to trackid),
`zabelin-russian` (identical source distribution pre/post, pure
intra-source re-ordering noise), and `sara-landry-hex` (top-10
trackid contribution went 2→1; this is the only regression with
a plausible architectural link, but the seed is volatile across
runs — 0.8472 / 1.0000 / 0.9487 / 0.7911 across consecutive runs
this session — making the signal hard to disentangle from noise).
None of the regressions match a mechanism by which trackid would
displace a relevant track: trackid candidates remain unique to its
list, so they don't accumulate multi-source RRF score and don't
push other top-10 tracks out — Stage E will give the correct lens
for measuring this kind of contribution.

The metric does not see ranks 11+ where trackid's contributions live.
This is a known limitation that Stage E (random sampling with
structural metrics) addresses, and it is not a reason to defer the
rewrite — the trackid contribution still feeds:

  - **Stage D learned ranking** — sees the full candidate list, not just
    the top-10, so unique trackid candidates can be weighted by a
    learned model.
  - **Stage C3 features** — `TrackidCooccurrence` cache will be
    populated by this adapter's calls and joined into
    `CandidateFeatures` for Stage D training data.
  - **Discovery breadth** — even when trackid candidates don't surface
    to the user in top-10, they widen the candidate pool considered
    by every downstream filter and re-rank, which matters when
    feedback signals (likes, dislikes) reshape the ranking.

**No new dependencies.** The adapter is plain `httpx` JSON parsing;
BeautifulSoup is no longer used by trackid (still used by Bandcamp).
The `TrackidCooccurrence` cache table and the `fetch_/upsert_trackid_
cooccurrence_batch` helpers in `python-service/app/core/db.py` remain
valid for Stage C3 to populate.

**Per-search cost.** 1 search call + 1 playlists-list call + up to 15
detail calls (semaphore=5, so ~3 sequential batches). Bounded by
`TIMEOUT_SECONDS = 8.0` per call inside the adapter and the
`TRACKIDNET_TIMEOUT = 25.0s` hard cap in
`python-service/app/api/routes/similar.py` (bumped from 9.0s in this
ADR; the previous min/max flow only made 3 calls so 9s sufficed). The
cold-cache wall clock is ~8–15s per seed when trackid is responsive.
If trackid becomes a bottleneck (rate limit, latency creep) the C3
cache absorbs most of the cost.

**Picker caveat.** When a search matches both an original and a remix,
the picker takes the higher `playCount`. If the user typed the remix
title but the original is more played, candidates will be drawn from
the original's sets. Acceptable for v1; the picker signature is small
enough to revisit if eval flags it.

## Supersedes

The `Stage B3 ships disabled` posture documented in
`python-service/app/adapters/trackidnet.py` TODO comments and in
ADR-0012's note that "trackid.net is retained as the DJ-set
co-occurrence source [but is] also flag-disabled pending selector
verification per the TODO comments." Per the project convention in
[adr-writing](../../../.agents/skills/adr-writing/SKILL.md) (don't
edit prior ADRs to match new behavior), ADR-0012's wording is left
intact and this ADR records the current state.

The first JSON rewrite using only `minCreatedSlug` and
`maxCreatedSlug` (commit 99b97ce) is superseded by the playlists-list
flow described above. The min/max approach was kept in git history
so the architectural evolution is auditable.
