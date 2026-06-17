---
"@trackdigger/python-service": minor
"@trackdigger/web": patch
---

Add a Discogs collaborative-filtering source to `/similar`. For a seed release it samples up to 3 collectors who Have/Want it (topping up from Want when Have is thin), pulls up to 3 releases per collector whose Discogs styles overlap the seed's, and surfaces them with a "Discogs" source badge on track cards. Owner enumeration only exists on the Cloudflare-gated stats page, so the build runs offline (`scripts/warm_discogs_similar.py`, gated by `DISCOGS_STATS_UNBLOCKER_URL`) and the `/similar` hot path serves the warmed cache — a cold seed contributes nothing rather than adding the scrape and collection fan-out to the critical path. Search cache bumped to v15.
