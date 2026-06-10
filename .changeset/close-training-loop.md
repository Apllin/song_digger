---
"@trackdigger/python-service": minor
"@trackdigger/web": minor
---

Close the training loop end-to-end so trained weights actually move ranking. Python `TrainingResult` now returns five new coefficients (`bpm_delta_weight`, `bpm_compatible_weight`, `bpm_present_weight`, `key_compatible_weight`, `key_present_weight`); previously they were computed by the logistic regression but discarded on the way out. `ModelWeights` Prisma schema gains matching nullable fields and `trainApi` persists them. `aggregateTracks` now decorates the RRF-fused result with per-candidate bonuses for `cosineScore`, `numSources`, and BPM/key signals, sourced from previously cached `Track.bpm` / `Track.musicalKey` and the latest enriched `SearchQuery.seedBpm` / `seedMusicalKey`. Each audio contribution is clipped to ±0.005 — about a third of one top-rank source contribution — so audio nudges break ties between equally-ranked candidates without overriding multi-source consensus. New admin page at `/admin/train` exposes a button to trigger training and shows the active model's weights breakdown.
