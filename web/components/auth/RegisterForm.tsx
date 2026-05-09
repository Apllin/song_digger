"use client";

import { DetailedError, parseResponse } from "hono/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TurnstileWidget } from "./TurnstileWidget";

import { api } from "@/lib/hono/client";

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const router = useRouter();

  // Shows the widget only when the site key is configured. In dev with
  // unset keys the form still works, mirroring how every other env var
  // in this repo is treated. Production deployment requires both keys.
  const captchaConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    if (captchaConfigured && !turnstileToken) {
      setPending(false);
      setError("Please complete the CAPTCHA before submitting.");
      return;
    }

    let result;
    try {
      result = await parseResponse(
        api.auth.register.$post({
          json: {
            email: String(formData.get("email") ?? ""),
            password: String(formData.get("password") ?? ""),
            turnstileToken,
            website: String(formData.get("website") ?? ""),
          },
        }),
      );
    } catch (err) {
      setPending(false);
      const data = err instanceof DetailedError ? (err.detail?.data as { error?: string } | undefined) : undefined;
      setError(data?.error ?? "Something went wrong. Please try again.");
      setTurnstileToken("");
      return;
    }
    setPending(false);

    if ("error" in result) {
      setError(result.error);
      // Token is single-use; force a fresh one before retry.
      setTurnstileToken("");
    } else {
      router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {/* Honeypot. Real users won't fill (off-screen, no tab stop,
          aria-hidden); bots that auto-fill every input will. The
          server treats a non-empty value as a bot fingerprint and
          fakes a success response. */}
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
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
        <p className="text-xs text-zinc-500 mt-1">At least 8 characters</p>
      </div>
      {captchaConfigured && (
        <TurnstileWidget
          action="register"
          theme="dark"
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken("")}
          onError={() => setTurnstileToken("")}
        />
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Creating account..." : "Create account"}
      </button>
      <p className="text-xs text-center text-white">
        Already have an account?{" "}
        <a href="/login" className="text-blue-400 hover:underline">
          Sign in
        </a>
      </p>
    </form>
  );
}
