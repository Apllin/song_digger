import { Hono } from "hono";
import { favoriteAddRoute } from "./favoriteAdd";
import { favoriteDeleteRoute } from "./favoriteDelete";
import { favoriteIdsRoute } from "./favoriteIds";
import { favoriteListRoute } from "./favoriteList";

import type { AppEnv } from "@/lib/hono/types";

export const favoriteApi = new Hono<AppEnv>()
  .route("/", favoriteIdsRoute)
  .route("/", favoriteListRoute)
  .route("/", favoriteAddRoute)
  .route("/", favoriteDeleteRoute);
