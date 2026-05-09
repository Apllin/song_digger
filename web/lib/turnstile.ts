// Cloudflare Turnstile server-side validation.
// Each token can only be verified once and expires after 5 minutes; the
// server is the trust boundary, the widget alone proves nothing. ADR-0021.
//
// Test keys (publicly documented at
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
//   site key always-pass:    1x00000000000000000000AA
//   secret key always-pass:  1x0000000000000000000000000000000AA
//   site key always-fail:    2x00000000000000000000AB
//   secret key always-fail:  2x0000000000000000000000000000000AA

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export interface VerifyOptions {
  /** Optional remote IP forwarded to Cloudflare. Improves analytics. */
  remoteIp?: string;
  /** Optional UUID for safe retries. */
  idempotencyKey?: string;
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  options: VerifyOptions = {},
): Promise<boolean> {
  if (!token) return false;

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail-closed: a misconfigured deployment must not silently let
    // unverified submissions through. Loud log so the operator notices.
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set");
    return false;
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (options.remoteIp) formData.append("remoteip", options.remoteIp);
  if (options.idempotencyKey) {
    formData.append("idempotency_key", options.idempotencyKey);
  }

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: formData });
    if (!res.ok) {
      console.error(`[turnstile] siteverify HTTP ${res.status}`);
      return false;
    }
    const data = (await res.json()) as TurnstileVerifyResponse;
    if (!data.success) {
      console.warn(`[turnstile] verification failed: ${data["error-codes"]?.join(", ") ?? "no error codes"}`);
    }
    return data.success === true;
  } catch (err) {
    // Treat network errors as failure. Fail-open here would be the
    // attack vector — an attacker could DoS Cloudflare or block the
    // egress and bypass CAPTCHA.
    console.error("[turnstile] siteverify request error:", err);
    return false;
  }
}
