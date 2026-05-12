---
"@trackdigger/web": patch
---

Search results and favorites now paginate server-side (skip/take + page/pages/per_page/items metadata) the same way discography and labels do, with the shared `Pagination` component moved to `web/components/Pagination.tsx` and an 18-per-page size shared by both grids.

- Search pages are read straight from the persisted SearchResult rows via `GET /api/search/:id`, replacing the client-side "Show 18 more" counter. Only disliked tracks are filtered out of a page; favorited tracks stay in place with the heart on their card lit up.
- New `/favorites` page (with a nav tab) lists saved tracks page by page.
- Prev/Next keeps the current page visible with a small centered loader instead of blanking the grid.
- Favoriting is idempotent (`POST /api/favorites` no longer 409s on a re-add, and returns a clean 401 instead of a 500 when the session points at a user that no longer exists).
- The search bar no longer auto-opens its suggestions dropdown when the page is revisited with a pre-filled query.
