"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { TurnstileWidget } from "./TurnstileWidget";
import { loginPrecheckAction } from "@/app/actions/login-precheck";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requireCaptcha, setRequireCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const router = useRouter();

  const captchaConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function refreshCaptchaRequirement(email: string) {
    if (!captchaConfigured) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      const result = await loginPrecheckAction(trimmed);
      if (result.requireCaptcha) setRequireCaptcha(true);
    } catch {
      // Network glitch — leave requireCaptcha as is. The server still
      // enforces the threshold; the client check is just UX.
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const honeypot = String(formData.get("website") ?? "");

    // Honeypot: real users can't reach this field (off-screen, no
    // tab stop, aria-hidden). Pretend to log them in so the bot
    // sees no signal it was detected, but skip signIn() entirely
    // — no row in LoginAttempt, no auth cookie, no redirect.
    if (honeypot.length > 0) {
      setPending(false);
      setError("Invalid email or password, or email not verified");
      return;
    }

    if (requireCaptcha && !turnstileToken) {
      setPending(false);
      setError("Please complete the CAPTCHA below.");
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      turnstileToken,
      redirect: false,
    });
    setPending(false);

    if (!result || result.error) {
      const code = result?.code ?? "";
      if (code === "RATE_LIMIT") {
        setError("Too many failed attempts from this address. Try again in 15 minutes.");
      } else if (code === "CAPTCHA_REQUIRED") {
        setRequireCaptcha(true);
        setError("Please complete the CAPTCHA below and submit again.");
      } else {
        setError("Invalid email or password, or email not verified");
        // Re-check threshold; this attempt may have just crossed 3
        // failures. The server check is the source of truth.
        await refreshCaptchaRequirement(email);
      }
      // Tokens are single-use — clear so the next submit grabs a
      // fresh one (the widget auto-resets on its side).
      setTurnstileToken("");
      return;
    }

    router.push("/");
    // Refresh so server components (nav, etc.) see the new session cookie.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Honeypot — see RegisterForm for rationale. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] top-[-9999px] h-0 w-0 opacity-0"
      />
      <div>
        <label className="block text-sm mb-1" htmlFor="email">
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          autoComplete="email"
          onBlur={(e) => refreshCaptchaRequirement(e.currentTarget.value)}
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm mb-1" htmlFor="password">
          Password
        </label>
        <input
          type="password"
          id="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>
      {captchaConfigured && requireCaptcha && (
        <div>
          <p className="text-xs text-zinc-500 mb-2">
            Please verify you&rsquo;re not a robot:
          </p>
          <TurnstileWidget
            action="login"
            theme="dark"
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken("")}
            onError={() => setTurnstileToken("")}
          />
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <div className="flex justify-between text-xs">
        <a
          href="/forgot-password"
          className="text-zinc-400 hover:text-zinc-300"
        >
          Forgot password?
        </a>
        <a href="/register" className="text-blue-400 hover:underline">
          Create account
        </a>
      </div>
    </form>
  );
}
