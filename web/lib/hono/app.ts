import { Hono } from "hono";
import type { AppEnv } from "./types";

import { authApi } from "@/features/auth/server/authApi";
import { bandcampAudioApi } from "@/features/bandcampAudio/server/bandcampAudioApi";
import { discographyApi } from "@/features/discography/server/discographyApi";
import { dislikeApi } from "@/features/dislike/server/dislikeApi";
import { embedApi } from "@/features/embed/server/embedApi";
import { favoriteApi } from "@/features/favorite/server/favoriteApi";
import { healthApi } from "@/features/health/server/healthApi";
import { labelApi } from "@/features/label/server/labelApi";
import { searchApi } from "@/features/search/server/searchApi";
import { suggestionApi } from "@/features/suggestion/server/suggestionApi";

export const app = new Hono<AppEnv>()
  .basePath("/api")
  .use("*", async (c, next) => {
    c.set("pythonServiceUrl", process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000");
    await next();
  })
  .route("/", authApi)
  .route("/", bandcampAudioApi)
  .route("/", discographyApi)
  .route("/", dislikeApi)
  .route("/", embedApi)
  .route("/", favoriteApi)
  .route("/", healthApi)
  .route("/", labelApi)
  .route("/", searchApi)
  .route("/", suggestionApi);

export type AppType = typeof app;
