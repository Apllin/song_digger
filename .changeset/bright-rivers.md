---
"@trackdigger/web": minor
"@trackdigger/python-service": minor
---

Add Bandcamp as a secondary source for label discography. When Discogs's latest known release for a label is more than a year old, the new `/discography/label/{id}/releases` orchestrator falls back to Bandcamp to surface fresher releases (and their tracklists) that Discogs hasn't ingested yet. Tracklist fetching is now source-aware so a Bandcamp release routes through the new `/bandcamp/release/tracklist` endpoint while Discogs releases keep using their existing path. Also fixes a long-standing bug where the selected label/artist was lost after navigating away from `/labels` or `/discography` — both pages now persist the selection in their Jotai atom, with the underlying `useEntitySearch` re-entry loop avoided by stabilising the page-level `fetchFn` and `onSelect` callbacks via `useCallback`.
