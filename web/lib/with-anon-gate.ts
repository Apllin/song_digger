import { DetailedError } from "hono/client";

// Wraps an awaited Hono-RPC `parseResponse(...)` so anonymous-limit
// responses (429 ANONYMOUS_LIMIT_REACHED, ADR-0021) surface as a single
// side-effect call to onAnonLimit, returning null. Callers short-circuit
// on null. Other errors (network, non-anon 429s, validation) re-throw
// unchanged.
export async function withAnonGate<T>(promise: Promise<T>, onAnonLimit: () => void): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (
      err instanceof DetailedError &&
      (err.detail?.data as { error?: string } | undefined)?.error === "ANONYMOUS_LIMIT_REACHED"
    ) {
      onAnonLimit();
      return null;
    }
    throw err;
  }
}
