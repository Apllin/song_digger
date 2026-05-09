---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Discography page now paginates through Discogs server-side instead of preloading the full discography. Filtering by Main role and sorting by year are delegated to Discogs via native query params, so artists with hundreds of releases render the first page in one round-trip instead of waiting for every page to fan out in parallel.
