---
"@trackdigger/python-service": minor
"@trackdigger/web": minor
---

Restore Beatport BPM and Camelot key enrichment. The Beatport adapter is back, scoped to a fire-and-forget `/enrich` endpoint that fills `Track.bpm` / `Track.musicalKey` (and `SearchQuery.seedBpm` / `seedMusicalKey`) after a search returns. Track cards now show a BPM · key chip when either value is available, and the search page auto-refetches once ~25s after results so chips appear without a manual reload. The training feature vector grows from 9 to 14 floats with the new `bpmDelta` / `bpmCompatible` / `bpmPresent` / `keyCompatible` / `keyPresent` signals (±6 BPM threshold; Camelot wheel compatibility for keys).
