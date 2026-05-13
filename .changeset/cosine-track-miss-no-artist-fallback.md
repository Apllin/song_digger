---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Fix Cosine.club results when the queried track isn't in its catalogue. The `/similar` route no longer falls back to a bare-artist Cosine query when the "Artist - Track" (and reversed "Track - Artist") lookups don't resolve to a confident seed — a bare-artist query bypasses the adapter's seed-relevance gate, so it accepted whatever Cosine's fuzzy search returned and recommended off an unrelated seed. Now Cosine simply contributes nothing in that case. The reversed-order retry stays. `SEARCH_CACHE_VERSION` bumped `v6` → `v7`. See ADR-0024.
