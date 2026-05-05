// Wraps fetch() so anonymous-limit responses (429
// ANONYMOUS_LIMIT_REACHED) surface as a single side-effect call to
// onAnonLimit, returning null. Callers short-circuit on null so the
// body isn't consumed twice. Other 429s (e.g., upstream rate limits)
// pass through unchanged. ADR-0021.
export async function fetchWithAnonGate(
  url: string,
  init: RequestInit | undefined,
  onAnonLimit: () => void,
): Promise<Response | null> {
  const res = await fetch(url, init);
  if (res.status === 429) {
    const body = await res.clone().json().catch(() => ({}));
    if (body?.error === "ANONYMOUS_LIMIT_REACHED") {
      onAnonLimit();
      return null;
    }
  }
  return res;
}
