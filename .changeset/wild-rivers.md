---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Migrate web data fetching to TanStack Query (favorites, dislikes, search polling, autocomplete on discography/labels/home). Move Discogs artist-release dedup, year sort, and Main-role filter into the Python service so a single request returns the full sorted list, fixing both the chronological-order break across pages and the duplicate `/api/discography/search` request from the Search button.
