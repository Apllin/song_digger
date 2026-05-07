# Source Availability

> **Operational snapshot of external source adapter health.**
> Last verified: 2026-05-04. Re-validate (commands at the bottom) before
> trusting this for new work — sources break and recover independently.

## tl;dr

[scoring.md](scoring.md) describes a multi-source RRF pipeline, and the
code path is wired exactly that way. **As of 2026-05-04, the active
contributors are: YouTube Music Radio, Bandcamp, Cosine.club (post-API
migration), Last.fm, and trackid.net.** Cosine.club moved to a new
public API at `https://cosine.club/api` (the previous `api.cosine.club`
host went NXDOMAIN — the adapter was rewritten to point at the new
endpoint and no longer returns BPM/key/energy/label/genre, which now
come from Beatport enrichment only). Bandcamp uses the public
`bcsearch_public_api` JSON endpoint and the `<li class="recommended-album">`
footer format. Last.fm uses `track.getSimilar` for Artist–Track queries
and falls back unconditionally to `artist.getSimilar` →
`artist.getTopTracks` (top-3 per similar artist, capped at 30) when
track-level returns empty or the query is artist-only — see ADR-0022.
Trackid.net
was rewritten as a JSON API client (playlists-list flow over three
public endpoints — `/musictracks`, `/audiostreams?musicTrackId=`,
`/audiostreams/<slug>` — with `±5` window in up to 15 fresh sets) and
enabled by default — see ADR-0014; the previous HTML-scraping attempt
failed because trackid.net is a React SPA with no server-rendered
tracklist HTML. Beatport is
still anti-bot-blocked for the public scraper but contributes only as
inline BPM/key enrichment, not as an RRF input. Yandex is still a no-op
without a token. 1001tracklists was removed in Stage A.5 v2 (see ADR-0012).

This is not a code bug. The aggregator and the adapter wiring are
correct. It's an external-services bill of health.

## Per-source status

| Source | Status | Symptom | Action |
|---|---|---|---|
| `cosine_club` | ✓ Works (post-API migration 2026-05) | New public API at `https://cosine.club/api` — two-step `/v1/search` → `/v1/tracks/{id}/similar`. Returns rank + YouTube URLs only; BPM/key/energy/label/genre are no longer in the public schema. The previous `api.cosine.club` host went NXDOMAIN; the adapter was rewritten to use the new endpoint. Requires `COSINE_CLUB_API_KEY`. | Watch for `[CosineClub] find_similar error:` log lines indicating the schema or auth shape shifted again. |
| `beatport` (enrichment + BPM/key fallback, not RRF) | ❌ 403 Forbidden | `Client error '403 Forbidden'` for every `/search/tracks?q=...` URL. Anti-bot (likely Cloudflare) blocking the unauthenticated scraper. | Switch to Beatport's official API (paid, requires partner agreement) or move BPM/key enrichment to a different source (MusicBrainz/AcousticBrainz, Mixed In Key API). |
| `bandcamp` | ✓ Works (rewritten 2026-05-01) | Returns 7 album recommendations per seed in 1.4–2.0 s (well inside the 4 s budget in [similar.py](../../python-service/app/api/routes/similar.py)). The previous version was silently returning `[]` because Bandcamp put `/search` behind Imperva's client-challenge AND changed the recommendation footer from `data-recommended-from-tralbum` JSON to `<li class="recommended-album">` blocks. The adapter now hits the public `bcsearch_public_api` JSON endpoint for search and parses the new `<li>` format on the track page. | Watch for `[Bandcamp] track page challenged` or `[Bandcamp] no recs in page` log lines — those indicate Imperva expanded the challenge to track pages or the footer markup changed again. |
| `yandex_music` | ⚠ No-op without token | `YANDEX_MUSIC_TOKEN` env var is unset; adapter early-returns `[]`. Documented behavior, but the env is empty in the dev `.env`. | Set the token if the developer has a Yandex account. Cheapest single improvement to source diversity. |
| `lastfm` | ✓ Works | `track.getSimilar` populates the primary list for Artist–Track queries. When that returns empty, OR when the input is artist-only (no `" - Track"`), the adapter falls back unconditionally to `artist.getSimilar` → top-3 per similar artist, capped at 30. Requires `LASTFM_API_KEY`. Per-artist similars cached in `LastfmArtistSimilars` (30-day TTL). See ADR-0022. | Watch for `[Lastfm]` log prefixes; nothing user-facing fails when the API key is missing (adapter early-returns `[]`). |
| `trackidnet` | ✓ Active (JSON API, playlists-list flow, verified 2026-05-04) | `trackidnet_enabled = True` default. Adapter uses three public JSON endpoints (no auth, no Cloudflare cookie): `/api/public/musictracks?keywords=` (search), `/api/public/audiostreams?musicTrackId=` (lightweight playlists list), `/api/public/audiostreams/<slug>` (per-playlist tracklist). Per-seed flow: search → pick best catalogue entry → list playlists for seed id (cap 15, sorted by `addedOn` desc) → fetch each tracklist concurrently (`Semaphore(5)`) → for each, take ±5 tracks around the seed → aggregate by slug across all windows, sort by count desc then `referenceCount` asc. The previous HTML scraper was abandoned because trackid.net is a React SPA. See ADR-0014. | Watch for `[Trackidnet] search failed`, `[Trackidnet] playlists list failed`, or `[Trackidnet] audiostream <slug> failed` log lines indicating the JSON shape changed or the endpoint moved behind auth. |
| `youtube_music` | ✓ Works | The most consistently-producing adapter — 10+ results per seed via the YTM Radio playlist. | — |

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
```

## Triage tasks

1. **Cosine.club: find or replace.** Either locate the new endpoint
   (Discord, registry.scalar.com page, email the provider) or pick a
   replacement: AcousticBrainz, MusicBrainz with audio features,
   Spotify's audio-features API. If replaced, ADR-0001
   (cosine-confidence-threshold) and ADR-0007 (beatport-cache-strategy)
   need a paragraph each on the migration.
2. **Beatport: API or replace.** The free scraper is dead. Beatport
   has an official API behind a partner agreement. Alternative:
   MusicBrainz's CC0 metadata + AcousticBrainz for audio features.
3. **Yandex token.** Easy win if the developer has an account.
