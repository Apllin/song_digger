---
"@trackdigger/python-service": patch
---

Fix Last.fm track.getSimilar fetch, which silently failed with a NameError (missing httpx import) and always fell back to artist-level results. The call now goes through the shared retry helper like the rest of the adapter, so track-level similars work again and transient errors get one retry.
