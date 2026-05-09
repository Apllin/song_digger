import { Hono } from "hono";

import type { AppEnv } from "@/lib/hono/types";
import { healthHealthGet } from "@/lib/python-api/generated/clients/healthHealthGet";

export const healthApi = new Hono<AppEnv>().get("/health", async (c) => {
  const pythonOk = await healthHealthGet({
    baseURL: c.var.pythonServiceUrl,
    signal: AbortSignal.timeout(3000),
  })
    .then(() => true)
    .catch(() => false);

  return c.json({
    status: "ok" as const,
    python_service: pythonOk ? ("ok" as const) : ("unavailable" as const),
  });
});
