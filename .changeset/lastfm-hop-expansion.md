---
"@trackdigger/python-service": minor
"@trackdigger/web": patch
---

Add lastfm_hop SourceList to /similar: multi-seed artist-similarity fan-out from query artist + top trackid artists surfaces ~18 niche tracks per request beyond what streaming recommenders return. Also fixes trackid seed picker to no longer filter out tracks with playCount=0 — that field is unreliable on /musictracks (niche tracks with 15+ real playlists were being dropped). Search cache bumped to v12.
