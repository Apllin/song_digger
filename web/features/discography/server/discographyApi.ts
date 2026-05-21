import { Hono } from "hono";
import { artistByIdRoute } from "./artistById";
import { artistReleasesRoute } from "./artistReleases";
import { artistSearchRoute } from "./artistSearch";
import { labelSearchRoute } from "./labelSearch";
import { tracklistRoute } from "./tracklist";

import type { AppEnv } from "@/lib/hono/types";

export const discographyApi = new Hono<AppEnv>()
  .route("/", artistSearchRoute)
  .route("/", artistByIdRoute)
  .route("/", artistReleasesRoute)
  .route("/", tracklistRoute)
  .route("/", labelSearchRoute);
