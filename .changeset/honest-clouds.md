---
"@trackdigger/web": patch
---

Discography page now fetches artist releases via React Query (`useArtistReleases` hook). The previous useEffect with manual `AbortController` is gone, paged data is cached so revisiting an artist or page is instant, and previous-page data stays visible while the next page is loading instead of flashing a spinner.
