---
"@trackdigger/python-service": minor
"@trackdigger/web": patch
---

Improve YouTube Music / Cosine seeding and clean source title tags. YTM now falls back to UGC video search (parsing the real Artist–Title) and seeds Cosine with the resolved track URL when the catalog misses; the DB pool soft-degrades on connection failure so Last.fm and other DB-backed sources survive an outage; and display titles are stripped of source service tags (promo banners, vinyl positions, catalogue/label tags) while version markers are preserved.
