---
"@trackdigger/python-service": patch
---

Stop cache-poisoning the Last.fm artist-similars cache on transient network failures. Extract a shared HTTP helper (`app/adapters/_http.py`) that retries once on transient errors (RemoteDisconnected, ConnectError, timeouts, 5xx) and returns `None` to distinguish "fetch failed" from "Last.fm returned 0 results". Migrate `lastfm` to use it: `_get_artist_similars_cached` no longer writes an empty list to the 30-day Postgres cache when the fetch errors, so a single blip no longer locks a niche artist out of the artist-level fallback for a month (TRA-19). The other 5 httpx-based adapters keep their current local error handling — migration tracked in TRA-20.
