---
"@trackdigger/web": minor
---

Player now resolves embeds for tracks with a null or incomplete source, so discography and label tracks fall through to the YTM/Bandcamp resolver instead of stalling on "No playback available". On the discography and label pages, the player chains album-by-album: after the last track of a release it auto-loads the next release (and the next page of releases when needed), and the matching accordion auto-expands.
