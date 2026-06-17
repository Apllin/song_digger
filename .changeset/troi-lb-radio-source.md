---
"@trackdigger/web": minor
"@trackdigger/python-service": minor
---

Add Troi (ListenBrainz lb-radio) as a similarity/discovery source. Feature-flagged on by default, contributes to the merged /similar set and to model training, caches prompt outputs with circuit-breaker + serve-stale degradation.
