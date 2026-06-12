---
"@trackdigger/web": patch
---

Fixed the player hanging when skipping to the next track. Two causes: the next-track preloader had drifted from the player's own resolution check, so it warmed the wrong set of tracks and the handoff stalled on a live resolve; and a quick next-click during the YouTube player's startup window was silently dropped, leaving playback stuck until the card was toggled off and on. Both paths now share one playability check, and a video requested before the player is ready is applied once it loads.
