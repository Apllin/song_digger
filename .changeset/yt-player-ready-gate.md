---
"@trackdigger/web": patch
---

Seek/toggle/poll on the YouTube player now wait until the iframe has fired `onReady`, fixing a `seekTo is not a function` crash when dragging the progress bar before the player finishes loading.
