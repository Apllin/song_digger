---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Fix track autocomplete: suggestions now match the typed title as a prefix (YTM-led hybrid), so "Joe Milli - M" surfaces "Joe Milli - Mantra" while typing instead of only matching a fully-typed title. Harden the search pipeline so a post-fetch failure marks the query `error` instead of stranding it in `running` forever.
