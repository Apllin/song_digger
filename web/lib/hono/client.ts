import { hc } from "hono/client";
import type { AppType } from "./app";

import { env } from "@/lib/env";

export const api = hc<AppType>(env.hostUrl).api;
