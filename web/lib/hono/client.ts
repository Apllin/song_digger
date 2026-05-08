import { hc } from "hono/client";
import { env } from "@/lib/env";
import type { AppType } from "./app";

export const api = hc<AppType>(env.hostUrl).api;
