# Typed API clients

This repo has two typed clients. Use them. Don't write raw `fetch` against either surface.

## Internal `/api/*` routes — Hono RPC

All requests to our own `/api/*` go through `@/lib/hono/client`, the typed RPC surface for the Hono app at [web/lib/hono/app.ts](web/lib/hono/app.ts).

```ts
import { api } from "@/lib/hono/client";
import { parseResponse } from "hono/client";

const data = await parseResponse(
  api.discography.label.releases.$get(
    { query: { labelId: String(labelId), page: "1", perPage: "100" } },
    { init: { signal } },
  ),
);
```

- Path segments, query/JSON inputs, and response bodies are all typed. A typo at the call site is a compile error.
- Inputs are typed against the route's Zod validator (`zValidator("query", Schema)`).
- Response is typed against the handler's `c.json(...)` return type.
- Always wrap in `parseResponse` (per `typescript/hono-parse-response.md`) — it throws `DetailedError` on non-2xx and returns a typed success body.

**Adding a route**: define `.get(...)` / `.post(...)` on the feature's router (`features/<name>/server/<name>Api.ts`), chain it on the root app at [web/lib/hono/app.ts](web/lib/hono/app.ts). The typed client picks it up — no client-side wiring.

## Python service — kubb-generated client

All requests to `python-service` go through the kubb-generated client at `@/lib/python-api/generated/clients/<operationId>`. The `<operationId>` is set on the FastAPI route via `operation_id="..."`.

```ts
import { getLabelReleases } from "@/lib/python-api/generated/clients/getLabelReleases";

const data = await getLabelReleases(
  labelId,
  { page, per_page: perPage },
  { baseURL: c.var.pythonServiceUrl },
);
```

- Wraps axios under the hood. Pass `{ baseURL }` on every call — typically `c.var.pythonServiceUrl` from the Hono context (see `lib/hono/types.ts`).
- The client validates the response via the generated Zod schema before returning. Drift between FastAPI and the consumer surfaces as an exception at the seam, not a silent type lie ten frames deeper.
- Generated files live under `web/lib/python-api/generated/{types,zod,clients}/` and are **gitignored**. Run `pnpm codegen` after touching FastAPI routes or Pydantic models.

**Adding an endpoint**: annotate the FastAPI route with `operation_id="..."` and `response_model=...` (a Pydantic model). Without `response_model`, kubb generates `any` for the response and the typed client buys you nothing. Then `pnpm codegen` and the new `<operationId>.ts` appears under `clients/`.

## Why not raw `fetch`

A raw `fetch` to either surface gives `any` for the response, hardcodes the URL, and silently rots when the server changes. Both clients above carry the URL, input schema, and response schema in the type system — a refactor on one side surfaces in the call sites at compile time instead of at runtime.
