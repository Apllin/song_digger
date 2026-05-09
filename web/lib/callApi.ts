import type { ClientResponse } from "hono/client";
import { DetailedError, parseResponse } from "hono/client";

import { apiEvents } from "@/lib/apiEvents";

function isAnonLimitError(err: unknown): boolean {
  return (
    err instanceof DetailedError &&
    (err.detail?.data as { error?: unknown } | undefined)?.error === "ANONYMOUS_LIMIT_REACHED"
  );
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof DetailedError && err.statusCode === 429 && !isAnonLimitError(err);
}

export async function callApi<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (isAnonLimitError(err)) {
      apiEvents.emit("error:anon-limit");
      return null;
    }
    if (isNetworkError(err)) {
      apiEvents.emit("error:network");
      return null;
    }
    if (isRateLimitError(err)) {
      const body = err instanceof DetailedError ? (err.detail?.data as { retryAfter?: number } | undefined) : undefined;
      apiEvents.emit("error:rate-limit", { retryAfterSeconds: body?.retryAfter ?? null });
      return null;
    }
    // Unregistered error — log and surface a generic message.
    // TODO: replace alert with shadcn toast once integrated.
    console.error("[api] unhandled error:", err);
    const message = err instanceof DetailedError ? err.message : "An unexpected error occurred. Please try again.";
    alert(message);
    return null;
  }
}

export async function fetchApi<T extends ClientResponse<unknown>>(promise: Promise<T>) {
  return callApi(parseResponse(promise));
}
