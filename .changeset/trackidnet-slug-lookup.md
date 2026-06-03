---
"@trackdigger/python-service": patch
---

Fix trackid.net adapter to use `musicTrackSlug` instead of `musicTrackId` when listing playlists. Their public API's id-keyed index doesn't surface every detected playlist for niche tracks — for example, `Sons Of Hidden - Transition` was returning zero playlists via `?musicTrackId=1314027` while the same track had associated audiostreams under `?musicTrackSlug=sons-of-hidden-transition`. The `trackidnet_playlists` cache key follows the slug as well; legacy id-keyed entries will simply expire naturally.
