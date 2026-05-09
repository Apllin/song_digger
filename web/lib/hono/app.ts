import { Hono } from "hono";
import type { AppEnv } from "./types";

import { healthApi } from "@/features/health/server/healthApi";
import { labelApi } from "@/features/label/server/labelApi";
import { suggestionApi } from "@/features/suggestion/server/suggestionApi";

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use("*", async (c, next) => {
    c.set("pythonServiceUrl", process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000");
    await next();
  })
  .route("/", healthApi)
  .route("/", labelApi)
  .route("/", suggestionApi);

export type AppType = typeof app;
