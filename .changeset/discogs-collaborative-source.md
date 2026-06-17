---
"@trackdigger/python-service": minor
"@trackdigger/web": patch
---

Add a Discogs collaborative-filtering source to `/similar`. For a seed release it samples up to 3 collectors who Have/Want it (topping up from Want when Have is thin), pulls up to 3 releases per collector whose Discogs styles overlap the seed's, and surfaces them with a "Discogs" source badge on track cards. Owner enumeration only exists on the Cloudflare-gated stats page (resolved via FlareSolverr, `DISCOGS_STATS_UNBLOCKER_URL`), so the build runs off the hot path and `/similar` serves a warm cache — a cold seed contributes nothing rather than adding the scrape and collection fan-out to the critical path. Warming is automatic: a background worker fills the cache following real search traffic (cache miss → enqueue → throttled build), with no cron or manual step; `scripts/warm_discogs_similar.py` remains for optional backfill. Search cache bumped to v15.
