import { Hono } from "hono";
import type { AppEnv } from "./types";

import { bandcampAudioApi } from "@/features/bandcampAudio/server/bandcampAudioApi";
import { discographyApi } from "@/features/discography/server/discographyApi";
import { embedApi } from "@/features/embed/server/embedApi";
import { healthApi } from "@/features/health/server/healthApi";
import { labelApi } from "@/features/label/server/labelApi";
import { suggestionApi } from "@/features/suggestion/server/suggestionApi";

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use("*", async (c, next) => {
    c.set("pythonServiceUrl", process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000");
    await next();
  })
  .route("/", bandcampAudioApi)
  .route("/", discographyApi)
  .route("/", embedApi)
  .route("/", healthApi)
  .route("/", labelApi)
  .route("/", suggestionApi);

export type AppType = typeof app;
