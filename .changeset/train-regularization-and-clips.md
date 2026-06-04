---
"@trackdigger/python-service": patch
---

Tighten weight training: stronger L2 regularisation (`C=1.0` → `C=0.1`), narrower source weight clip (`[0.1, 10]` → `[0.3, 3.0]`), and symmetric `[-2, 2]` clip on aggregate/audio coefficients (cosineScore, numSources, BPM/key). With ~600 labelled samples the previous setup produced source weights pinned to the clip ceiling/floor and a `numSourcesWeight` of 30+, while the underlying per-source hit-rate spread was only ~33–62%. The new ranges keep coefficients close to what the data actually warrants — re-running `/admin/train` on the same feedback rows should produce coefficients in the ~0.5–2.5 band instead of the previous 0.1/10 boundary hits. Application-time `AUDIO_BONUS_CAP` remains as a second safety net.
