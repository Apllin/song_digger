---
"@trackdigger/python-service": patch
"@trackdigger/web": patch
---

Tune per-source /similar behaviour: Cosine contributes to artist-only search only on an exact seed match; trackidnet fetches playlists incrementally with a 50-track early-stop and reads the largest detection process; the Last.fm artist fallback samples 1 popular + 2 random tracks; the lastfm-hop fans out from 3 spread seeds (2 similars each); YouTube artist mode seeds from the artist radio station. Search cache bumped to v15.
