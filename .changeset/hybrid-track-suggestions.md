---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Fix track autocomplete: suggestions now match the typed title as a prefix (YTM-led hybrid), so "Joe Milli - M" surfaces "Joe Milli - Mantra" while typing instead of only matching a fully-typed title. Harden the search pipeline so a post-fetch failure marks the query `error` instead of stranding it in `running` forever. Fix a 500 on `/api/discography/search` (and other DB-backed endpoints) by soft-degrading the asyncpg pool and anchoring its TLS context on certifi, so a `sslmode=verify-full` DSN no longer requires a local root-cert file. Restore artist diversification (max 2 consecutive same-artist tracks) in paged results by persisting the post-aggregation order as `SearchResult.rank` and paging by it — `fetchSearchPage` re-sorted by score and discarded the diversification. Bump `SEARCH_CACHE_VERSION` to abandon degraded results cached during the DB outage.
