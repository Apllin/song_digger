---
"@trackdigger/web": patch
"@trackdigger/python-service": patch
---

Migrate the web `/api/*` layer to a single Hono app and the web→python calls to the kubb-generated client. Internal architecture only — same URLs, same JSON shapes, same anonymous-limit semantics for callers.
