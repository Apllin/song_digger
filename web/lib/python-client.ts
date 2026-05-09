import { cachedFetch } from "@/lib/dev-cache";
import type { SimilarRequest } from "@/lib/python-api/generated/types/SimilarRequest";
import type { SimilarResponse } from "@/lib/python-api/generated/types/SimilarResponse";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function fetchSimilarTracks(req: SimilarRequest): Promise<SimilarResponse> {
  const res = await cachedFetch(`${PYTHON_SERVICE_URL}/similar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(`Python service error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
