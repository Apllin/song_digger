# 0023 — Remove Bandcamp /similar adapter (keep player fallback)

**Date:** 2026-05-11
**Status:** Accepted

**Context:**
Bandcamp was one of the original `/similar` adapters and the only
non-YTM source the BottomPlayer could play directly: it shipped with
its own audio extraction path (`extractBandcampAudio` scraping the
`data-tralbum` blob for an mp3 stream URL) wired to a hidden
`<audio>` element in the bottom player. Three integration points kept
the surface alive across the stack:

1. `python-service/app/adapters/bandcamp.py` — search via the
   `bcsearch_public_api` JSON endpoint, scrape "you may also like"
   `<li class="recommended-album">` blocks on the seed track page,
   then per-album fetch + `data-tralbum` parse for first-track
   resolution. Hard 4 s timeout in `similar.py` per ADR-0006.
2. `web/lib/scrapers/bandcamp.ts` + `web/features/bandcampAudio/` +
   `web/features/player/hooks/useBandcampAudio.ts` — the streaming
   extraction route + the player hook that turns the extracted mp3
   URL into a `<audio>` source. Also wired into the embed-resolver as
   a YTM fallback for non-YTM tracks (yandex / lastfm / cosine).
3. `next.config.ts` — CSP allowed `frame-src https://bandcamp.com`
   (for the EmbeddedPlayer iframe path) and `media-src https://*.bcbits.com`
   (for the direct mp3 stream path). The Bandcamp.com URL pattern
   was also baked into the search-result `<a>` and the source-label
   maps in `TrackCard`, `BottomPlayer`, and prototypes data.

The Python adapter was operationally fragile — Imperva's
client-challenge interstitial could land on any HTML fetch, and the
"you may also like" markup has shifted twice in the project's
lifetime. Stage 2 will replace that source slot with SoundCloud,
which has a documented public API for similarity that doesn't fight
an anti-bot layer. The web-side scraper + mp3 extraction is a
different surface — it only fires per-(title, artist) pair when
embed-resolver needs a fallback after a YTM exact-match miss, so
brittleness there shows up as one negative cache row, not as a
missing source list on every search.

**Decision:**
Split the Bandcamp surface in two and remove only the heavier half:

**Removed (Python adapter — the `/similar` source):**
- `python-service/app/adapters/bandcamp.py` — adapter
- `python-service/tests/test_bandcamp.py` — adapter tests
- `python-service/app/api/routes/similar.py` — `BandcampAdapter`
  import, `_bandcamp` instance, `_bandcamp_safe`, `BANDCAMP_TIMEOUT`,
  the Phase 1 `gather` slot, the Phase 2 artist-fallback gather
  slot, and the `bandcamp` `SourceList` entry
- `python-service/tests/test_regression.py` — `_bandcamp_safe`
  patches in the Cosine-DNS-failure regression tests
- `python-service/tests/smoke/test_adapter_smoke.py` — bandcamp smoke
  test + `bandcamp` entry in the TrackMeta-shape spot-check
- `python-service/tests/speed/test_adapter_speed.py` — bandcamp
  per-adapter latency test + `BANDCAMP_P95_S`
- `python-service/tests/speed/test_similar_speed.py` — comment
  describing the hard cap
- `python-service/app/core/{db.py,models.py}` — comment cleanup
- `web/app/prototypes/data.ts` — `MockTrack.source` union loses
  `"bandcamp"`, mock entries that referenced it switch to
  `youtube_music`
- `web/tests/speed/aggregator-speed.test.ts` — drop `"bandcamp"`
  from the `SOURCES` tuple (now 5-source RRF benchmark)
- `web/features/search/searchCache.ts` — bump
  `SEARCH_CACHE_VERSION` from `"v5"` to `"v6"` (the Python
  `/similar` response loses one source list, so cached `v5`
  payloads are stale by definition — see CLAUDE.md gotcha)

**Kept (web-side embed-resolver fallback + player path):**
- `web/lib/scrapers/bandcamp.ts` — `searchBandcampSimilar` (used by
  embed-resolver to find an embeddable Bandcamp track for a given
  (title, artist) pair) and `extractBandcampAudio` (used by the
  player hook to pull the mp3 stream URL)
- `web/features/bandcampAudio/server/bandcampAudioApi.ts` — the
  `/api/bandcamp-audio?url=...` Hono route the player hook calls
- `web/features/player/hooks/useBandcampAudio.ts` — the player hook
- `web/features/player/hooks/useAudioPlayer.ts` — `BCPlayerReturn`
  branch + `useBandcampAudio` wiring
- `web/features/player/hooks/useMediaSession.ts` — `audioRef` param
  + the `track.source === "bandcamp"` branches in the play/pause
  action handlers
- `web/features/player/components/BottomPlayer.tsx` — the hidden
  `<audio>` element + the bandcamp local vars
  (`audioRef` / `audioUrl` / `audioEventHandlers`)
- `web/features/player/constants.ts` — `"bandcamp"` in
  `PLAYABLE_SOURCES` and `SOURCE_LABELS`
- `web/lib/embed-resolver.ts` — `tryBandcamp` runs as the second
  attempt after `tryYtmExact`
- `web/components/TrackCard.tsx` — `bandcamp: "Bandcamp"` source
  label (rendered when /api/embed resolves a yandex/lastfm/cosine
  track to Bandcamp)
- `web/next.config.ts` — `frame-src https://bandcamp.com` and
  `media-src https://*.bcbits.com` stay
- `web/prisma/schema.prisma` — `TrackEmbed.source` keeps
  `"youtube_music" | "bandcamp" | null`

**Doc updates:**
- `web/docs/source-availability.md`, `web/docs/scoring.md`,
  `web/docs/decisions/README.md`, `README.md`, `CLAUDE.md` — describe
  the new shape: Bandcamp is no longer a `/similar` source but
  remains an embed-resolver fallback
- `web/docs/decisions/0006-bandcamp-timeout-policy.md` — status
  flipped to `Superseded by ADR-0023` (the 4 s adapter timeout no
  longer exists; the embed-resolver path uses its own 8 s timeout
  per `tryYtmExact` + httpx defaults inside `searchBandcampSimilar`)

**Consequences:**
- Positive: one fewer HTML-scraping adapter to keep alive against
  upstream redesigns and Imperva interstitials. The /similar fan-out
  drops a Phase 1 gather slot and the Phase 2 artist-fallback slot,
  marginally tightening the cold-path latency envelope.
- Positive: yandex / lastfm / cosine / trackid tracks that YTM
  exact-match can't resolve still get a chance at inline playback —
  the embed-resolver's Bandcamp fallback covers them, with results
  cached in `TrackEmbed` so the per-(title, artist) Bandcamp scrape
  amortizes across users.
- Positive: the brittle Bandcamp surface is now load-shaped — it
  fires per-(title, artist) pair on a cache miss, not on every
  search across 30 candidates per Bandcamp source list. Fewer
  Imperva probes, smaller blast radius if the search API or
  `data-tralbum` selector breaks.
- Negative: tracks that only Bandcamp surfaced in /similar will not
  appear in search results until the SoundCloud replacement lands.
  Existing `Track` rows with `source="bandcamp"` stay in the DB —
  still readable via favorites / dislike history but not re-surfaced
  through fresh searches.
- Negative: the search-response cache invalidates on the version
  bump (`v5` → `v6`); the next search per (artist, track) pair pays
  the cold Python cost.

**Alternatives considered:**
- Keep the Python adapter "off" via a feature flag. Rejected — dead
  code carries ongoing maintenance overhead (Imperva probing, page
  redesigns, the `data-tralbum` selector breaking) and feature flags
  hide intent in code review.
- Remove the web-side player fallback too (collapse to YTM-only).
  Rejected after re-evaluation — yandex tracks that YTM doesn't
  index are very common in the underground-techno catalogue, and
  losing the Bandcamp fallback would make those tracks
  silently-unplayable instead of "Finding playable source… → plays".
  The fallback path's cost is bounded (one /api/embed resolution
  per cache miss; positive hits never expire), so the brittleness
  trade is much smaller than for the per-search adapter fan-out.
- Re-add the Python adapter from git history if SoundCloud
  underperforms. Acknowledged — re-adding takes about an hour.
  Stage 2's SoundCloud evaluation will judge the source on its own
  merits before any reversal.

**Revisit when:**
- Stage 2's SoundCloud adapter underperforms in coverage / quality
  evals AND no other source (Spotify, Apple Music, MusicBrainz)
  fills the underground-techno catalogue gap that Bandcamp used to
  cover. At that point, evaluate Bandcamp vs the new alternatives
  on equal footing rather than defaulting back.
- The Bandcamp `data-tralbum` mp3 extraction in
  `extractBandcampAudio` starts logging consistent
  `[Bandcamp] extract audio error:` failures — that's the signal to
  drop the player fallback too and live with "unavailable" until
  SoundCloud lands.
