import { Hono } from "hono";
import { favoriteAddRoute } from "./favoriteAdd";
import { favoriteAddBySourceRoute } from "./favoriteAddBySource";
import { favoriteDeleteRoute } from "./favoriteDelete";
import { favoriteDeleteBySourceRoute } from "./favoriteDeleteBySource";
import { favoriteIdsRoute } from "./favoriteIds";
import { favoriteListRoute } from "./favoriteList";
import { favoriteSourceUrlsRoute } from "./favoriteSourceUrls";

import type { AppEnv } from "@/lib/hono/types";

export const favoriteApi = new Hono<AppEnv>()
  .route("/", favoriteIdsRoute)
  .route("/", favoriteSourceUrlsRoute)
  .route("/", favoriteListRoute)
  .route("/", favoriteAddRoute)
  .route("/", favoriteAddBySourceRoute)
  .route("/", favoriteDeleteRoute)
  .route("/", favoriteDeleteBySourceRoute);
