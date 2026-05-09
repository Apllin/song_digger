import { Hono } from "hono";
import type { AppEnv } from "./types";

import { labelApi } from "@/features/label/server/labelApi";

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use("*", async (c, next) => {
    c.set("pythonServiceUrl", process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000");
    await next();
  })
  .route("/", labelApi);

export type AppType = typeof app;
