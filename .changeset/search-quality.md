---
"@trackdigger/python-service": minor
"@trackdigger/web": patch
---

Artist-only search now fans out across all 7 sources (lastfm, trackid via new /audiostreams keyword flow, and the lastfm hop are added to the previously-cosine/ytm/yandex/soundcloud-only path). Trackid keyword flow pulls tracks DJs play in their sets — for "Anfisa Letyago" this returns 50 tracks across ~47 unique adjacent artists. SoundCloud now drops DJ-set / podcast / radio-show uploads via title-regex + a seed-duration check (>20 min seed bails the source entirely). Search cache bumped to v13.
