---
"@trackdigger/web": minor
"@trackdigger/python-service": minor
---

Remove the Bandcamp `/similar` adapter ahead of a SoundCloud replacement (stage 2). The Python adapter, the `bandcamp` `SourceList` slot, the Phase 2 artist fallback, smoke/speed tests, and `SEARCH_CACHE_VERSION` (bumped `v5` → `v6`) are gone. The web-side Bandcamp scraper + mp3-extraction player path is kept as the YTM-fallback branch in `embed-resolver.ts`, so non-YTM tracks that YTM exact-match can't resolve still get a chance at inline playback before falling through to "unavailable". See ADR-0023.
