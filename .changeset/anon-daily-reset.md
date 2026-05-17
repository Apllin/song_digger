---
"@trackdigger/web": patch
---

Anonymous request limit now resets on a sliding 24-hour window per IP, so unauthenticated users get 5 free requests per day instead of 5 for life.
