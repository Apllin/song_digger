---
"@trackdigger/python-service": minor
"@trackdigger/web": minor
---

Review follow-ups for the Troi / search-quality PR:

- **Troi joins the trained ranking model.** The logistic-regression feature vector is re-laid out for 8 sources (was 7); Troi now earns a learned weight instead of riding at the default. All index constants derive from `len(SOURCES)`, so the layout stays consistent.
- **Adapters take a parsed query object.** `AbstractAdapter.find_similar` now receives a `ParsedQuery` (artist + optional track) parsed once at the `/similar` route, instead of each adapter re-splitting a raw `"Artist - Track"` string.
- **Single cache layer.** Per-adapter caches (Troi prompt outputs, Last.fm artist similars / top tracks, trackid seed/playlist/set) are removed; the web-side search-response cache that wraps `/similar` is the only cache layer. The python service is now a stateless compute step.
- **No source feature flags.** `TROI_ENABLED`, `TRACKIDNET_ENABLED`, and `YANDEX_MUSIC_ENABLED` are gone — a working source contributes, a broken one soft-degrades to `[]`.
- **Cover enrichment is client-side.** The server no longer runs the iTunes cover backfill on the search hot path; missing covers are resolved lazily per card via a new `/api/cover` endpoint. `saveTracks` backfills only ranking signals (bpm/key), never presentation (cover/embed).
