---
"web": minor
"python-service": minor
---

Replace all regex title cleaning/sanitization with an LLM (Claude Haiku 4.5)
normalizer. Titles are cleaned and canonical match keys generated server-side,
cached raw->canonical. Existing dislikes reset and search/embed caches start
fresh (keys changed; SEARCH_CACHE_VERSION bumped to v18).
