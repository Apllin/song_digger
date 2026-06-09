---
"@trackdigger/python-service": minor
"@trackdigger/web": minor
---

Make Beatport BPM/key enrichment eager: resolve it synchronously during the search so the whole candidate list carries bpm/key before fusion/sorting (and is captured in training features) instead of a fire-and-forget pass after the response. Distinguish a transient fetch failure from a definitive "not found" — failures are retried on the next search, "not found" is re-attempted after a 7-day cooldown, and found values are kept permanently. Raise Beatport enrich concurrency to 12 (env `BEATPORT_ENRICH_CONCURRENCY`) with retry backoff/jitter and granular timeouts. Removes the ~25s client auto-refetch since the data is now present in the first response.
