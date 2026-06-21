---
"@trackdigger/python-service": patch
"@trackdigger/web": patch
---

Persist the seed's Beatport genre so the trainer's genre conditioning actually gets signal. `SearchQuery.seedGenre` was read by the trainer (and `aggregator` genre adjustments) but never written — it was always null, so every sample fell into the "other" bucket and the genre×source / genre×cosine features were inert. Beatport already returns the genre in the same search payload used for BPM/key, so `enrich_tracks` now carries it through (`_fetch_bpm_key` returns genre alongside bpm/key), `resolveAudioFeatures` keeps the freshly-scraped seed genre, and `searchApi` persists it on the `SearchQuery` row. No new external calls.
