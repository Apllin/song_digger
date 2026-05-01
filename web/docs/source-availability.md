# Source Availability

> **Operational snapshot of external source adapter health.**
> Last verified: 2026-05-01. Re-validate (commands at the bottom) before
> trusting this for new work — sources break and recover independently.

## tl;dr

[scoring.md](scoring.md) describes a multi-source RRF pipeline, and the
code path is wired exactly that way. **As of 2026-05-01, two sources
contribute: YouTube Music Radio and Bandcamp.** Bandcamp was rewritten
on 2026-05-01 to use the public `bcsearch_public_api` JSON endpoint and
the new `<li class="recommended-album">` footer format, after the old
`/search` HTML page was put behind an Imperva client-challenge.
Cosine.club is gone from DNS, Beatport is anti-bot-blocked, and Yandex
is still a no-op without a token.

This is not a code bug. The aggregator and the adapter wiring are
correct. It's an external-services bill of health.

## Per-source status

| Source | Status | Symptom | Action |
|---|---|---|---|
| `cosine_club` | ❌ DNS gone | `[Errno 8] nodename nor servname provided, or not known` on every request. `host api.cosine.club` returns `NXDOMAIN`. | Find replacement domain (api.cosine.app? api.cosine.io?) or replace adapter with another audio-embedding service. The docstring on the adapter still points at `https://registry.scalar.com/@cosine/apis/cosineclub-api/` — verify there first. |
| `beatport` (enrichment + BPM/key fallback, not RRF) | ❌ 403 Forbidden | `Client error '403 Forbidden'` for every `/search/tracks?q=...` URL. Anti-bot (likely Cloudflare) blocking the unauthenticated scraper. | Switch to Beatport's official API (paid, requires partner agreement) or move BPM/key enrichment to a different source (MusicBrainz/AcousticBrainz, Mixed In Key API). |
| `bandcamp` | ✓ Works (rewritten 2026-05-01) | Returns 7 album recommendations per seed in 1.4–2.0 s (well inside the 4 s budget in [similar.py](../../python-service/app/api/routes/similar.py)). The previous version was silently returning `[]` because Bandcamp put `/search` behind Imperva's client-challenge AND changed the recommendation footer from `data-recommended-from-tralbum` JSON to `<li class="recommended-album">` blocks. The adapter now hits the public `bcsearch_public_api` JSON endpoint for search and parses the new `<li>` format on the track page. | Watch for `[Bandcamp] track page challenged` or `[Bandcamp] no recs in page` log lines — those indicate Imperva expanded the challenge to track pages or the footer markup changed again. |
| `yandex_music` | ⚠ No-op without token | `YANDEX_MUSIC_TOKEN` env var is unset; adapter early-returns `[]`. Documented behavior, but the env is empty in the dev `.env`. | Set the token if the developer has a Yandex account. Cheapest single improvement to source diversity. |
| `youtube_music` | ✓ Works | The only adapter consistently producing 10+ results per seed. Drives the entire ranked output today. | — |

## How this was discovered

While capturing the pre-Stage-B eval baseline
([baseline-pre-stage-b.json](../../python-service/eval/runs/baseline-pre-stage-b.json))
the source distribution across the top-10 of every seed was uniform:

```
mulero-horses             {'youtube_music': 10}
rene-wise-pleasure-note   {'youtube_music': 10}
linear-system-guanine     {'youtube_music': 10}
ignez-veil                {'youtube_music': 10}
_control_charlotte_apollo {'youtube_music': 10}
```

Zero `cosine_club`, zero `bandcamp`, zero `yandex_music` across 50
result slots. The Python service logs then surfaced the 403s and DNS
errors per request.

## Implications

### For the baseline

`baseline-pre-stage-b.json` is **a faithful snapshot of the system as
it actually ran on 2026-05-01**, not a snapshot of what the
architecture is supposed to do. Average nDCG of 0.9694 mostly reflects
metric saturation: with one source and a golden set tuned to Pole
Group / Klockworks-style hypnotic techno, YTM Radio surfaces nothing
the labels cover, every result lands in `unmarked` (rel = 1, neutral),
and `nDCG = 1.0` falls out of the math.

After the Bandcamp adapter was rewritten on 2026-05-01, the run was
repeated and saved as
[baseline-pre-stage-b-bandcamp-fixed.json](../../python-service/eval/runs/baseline-pre-stage-b-bandcamp-fixed.json):
average nDCG **0.8812** across the same 5 seeds, with bandcamp now
contributing 5/10 slots per seed. The lower number is *unsaturating*,
not regressing — the seeds that dropped (`ignez-veil` 1.0 → 0.82,
`_control_charlotte_apollo` 1.0 → 0.77) are exactly the ones where
bandcamp surfaced genuinely on-target tracks (Rene Wise on Skeleven
for Ignez, Amelie Lens on her own Bandcamp for Charlotte) that hit
the golden set's `relevant` labels. Stage B should be measured
against the bandcamp-fixed file; the original is preserved as the
historical record of the degraded state.

### For [scoring.md](scoring.md)

The doc describes RRF fusion across multiple sources. Today RRF has
exactly one input list per seed, so the fusion is a no-op and the
post-RRF nudges + diversification are doing all the work. When you
read scoring.md, mentally substitute "as soon as more than one source
returns results, …" for any sentence that talks about cross-source
behavior.

### For Stage B

Stage B adds Last.fm, 1001tracklists, and trackid.net. If those
adapters land while cosine_club / beatport / bandcamp are still
broken, Stage B will look like a huge jump in measured quality — but
some of that jump is just *having more than one source*, not the
specific co-play / tag signal those new sources contribute. Worth
disentangling in the Stage B writeup.

## Re-validation commands

Run these before relying on this document for new decisions:

```bash
# 1. Cosine.club DNS
host api.cosine.club
# Expected when healthy: an A-record. NXDOMAIN means still down.

# 2. Beatport scraper
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://www.beatport.com/search/tracks?q=Oscar+Mulero"
# Expected when healthy: 200. 403 means still anti-bot-blocked.

# 3. Bandcamp adapter (smoke)
cd python-service && .venv/bin/python -c "
import asyncio
from app.adapters.bandcamp import BandcampAdapter
print(asyncio.run(BandcampAdapter().find_similar('Oscar Mulero - Horses')))
" 2>&1 | head -5

# 4. Yandex token
grep -c '^YANDEX_MUSIC_TOKEN=' .env

# 5. End-to-end source distribution (the discovery method itself)
cd python-service && .venv/bin/python -m eval.runner --filter mulero
# Then: cat eval/runs/<latest>.json | python3 -c "
#   import json,sys; from collections import Counter
#   d=json.load(sys.stdin)
#   for r in d['results']:
#       print(r['id'], dict(Counter(t['source'] for t in r['results'])))"
```

## Triage tasks (separate from Stage A.5)

These are not Stage B prerequisites — Stage B can proceed against the
current degraded baseline and the diff will still be informative — but
they are prerequisites for the cosine/beatport-dependent claims in
scoring.md to actually be operational claims.

1. **Cosine.club: find or replace.** Either locate the new endpoint
   (Discord, registry.scalar.com page, email the provider) or pick a
   replacement: AcousticBrainz, MusicBrainz with audio features,
   Spotify's audio-features API. If replaced, ADR-0001
   (cosine-confidence-threshold) and ADR-0007 (beatport-cache-strategy)
   need a paragraph each on the migration.
2. **Beatport: API or replace.** The free scraper is dead. Beatport
   has an official API behind a partner agreement. Alternative:
   MusicBrainz's CC0 metadata + AcousticBrainz for audio features.
3. ~~**Bandcamp: investigate the empty-result rate.**~~ Done 2026-05-01:
   adapter rewritten to use the JSON search API and the new
   `<li class="recommended-album">` footer. Distinct log lines now
   surface each failure mode (`search empty`, `search api error`,
   `track page challenged`, `no recs in page`).
4. **Yandex token.** Easy win if the developer has an account.
