import type { ClientResponse } from "hono/client";
import { DetailedError, parseResponse } from "hono/client";

import { apiEvents } from "@/lib/apiEvents";
import { parseErrorName } from "@/lib/hono/parseError";

export async function callApi<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof DetailedError && err.code === 401) {
      apiEvents.emit("error:session-expired");
      throw err;
    }
    const errorName = parseErrorName(err);
    if (errorName === "TypeError") {
      apiEvents.emit("error:network");
    } else if (errorName === "ANONYMOUS_LIMIT_REACHED") {
      apiEvents.emit("error:anon-limit");
    } else if (errorName !== "AbortError") {
      console.error("[api] unhandled error:", err);
    }
    throw err;
  }
}

export async function fetchApi<T extends ClientResponse<unknown>>(promise: Promise<T>) {
  return callApi(parseResponse(promise));
}
