import { Hono } from "hono";
import { artistReleasesRoute } from "./artistReleases";
import { artistSearchRoute } from "./artistSearch";
import { labelSearchRoute } from "./labelSearch";
import { tracklistRoute } from "./tracklist";

import type { AppEnv } from "@/lib/hono/types";

export const discographyApi = new Hono<AppEnv>()
  .route("/", artistSearchRoute)
  .route("/", artistReleasesRoute)
  .route("/", tracklistRoute)
  .route("/", labelSearchRoute);
