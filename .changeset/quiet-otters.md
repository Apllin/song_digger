---
"@trackdigger/web": minor
"@trackdigger/python-service": minor
---

Player gains a paginated playlist extender so the search queue continues across page boundaries; unplayable tracks now auto-skip via onEnded. Seed search in cosine/yandex/ytm now requires an exact title match for "Artist - Title" queries and falls back to artist-only matching for bare-artist queries, dropping the source when no candidate qualifies.
