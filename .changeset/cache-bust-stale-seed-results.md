---
"@trackdigger/web": patch
---

Bump SEARCH_CACHE_VERSION to v12 to evict stale `/similar` results that were cached before the recent cosine/yandex/ytm seed-match fixes (57a4f4e, 40e9197, 66b4eab, 1b2709f). Those fixes changed what cosine returns for queries whose track is missing from its catalog (e.g. "Inox Traxx - Difference"), but the prior 14-day cached responses kept serving off-genre seeds.
