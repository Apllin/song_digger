---
"@trackdigger/python-service": patch
"@trackdigger/web": patch
---

Fix SoundCloud results leaking the queried track itself — the `/recommended` page links back to the seed via its player widget, so the seed is now excluded from the parsed results.
