# Architecture Rules

| # | Rule | Description | File |
|---|------|-------------|------|
| 1 | Feature folders | Organize `web/` by feature area under `web/features/<feature>/`; pages and API routes stay in `app/` as thin shims | `feature-folders.md` |
| 2 | File and folder naming | camelCase everywhere, PascalCase only for React component files | `file-naming.md` |
| 3 | Typed API clients | Use the Hono RPC client for `/api/*` and the kubb-generated client for python-service calls; never raw `fetch` against either | `typed-clients.md` |
