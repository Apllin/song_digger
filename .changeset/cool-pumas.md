---
"@trackdigger/web": patch
---

Discography track lists no longer mis-attribute every track on a release to the searched artist. Discogs only tags a track with its own `artists` when the performer differs from the release's headline artist, so tracks on a release where the searched artist is just a remixer/contributor (`role` = Remix / Appearance / TrackAppearance / Producer) came back with an empty artist list and were stamped with the searched artist's name — which then made the YouTube Music lookup fail and show "no player". The release's headline artist is now carried through (`ArtistRelease.artist` from Discogs → `ArtistRelease.artist` Prisma column → `DiscographyRelease.artist`) and used as the per-track fallback instead.
