---
"@trackdigger/python-service": patch
"@trackdigger/web": patch
---

Validate the SoundCloud search seed with the shared query-match scorer before fetching recommendations — a fuzzy hit like a label-uploaded DJ mix no longer becomes the seed, and an unvalidated query contributes nothing. Also cache Last.fm track.getSimilar (7-day TTL), the last uncached Last.fm path. Search cache bumped to v14.
