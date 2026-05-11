---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Add per-request cost instrumentation (RequestMetric table populated by Hono middleware + Prisma extension + FastAPI middleware), batch TrackEmbed cache lookups in the search worker, and refactor label-releases to a server-side full sorted+deduped list with lazy per-page client fetching.
