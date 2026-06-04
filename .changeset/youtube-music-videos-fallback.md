---
"@trackdigger/python-service": patch
---

YouTube Music adapter now falls back to a `filter=videos` search when the `filter=songs` catalogue has no match for an `Artist - Title` query. Many niche label releases (small techno labels, label-channel uploads) live on YT Music only as user-uploaded videos — the songs catalogue misses them, our strict seed matcher correctly rejected the near-but-not-exact song results, and the adapter returned zero. The fallback applies a stricter token-subset matcher to videos (every word of the query must appear in the video title) so off-target videos don't bleed in. Bare-artist queries are not affected — the videos fallback is only attempted when a separator is present, since the token-subset rule is too permissive without a title to anchor on.
