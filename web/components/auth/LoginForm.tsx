"use client";

import { parseResponse } from "hono/client";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { TurnstileWidget } from "./TurnstileWidget";

import { api } from "@/lib/hono/client";

export function LoginForm({
  initialEmail = "",
  autoFocusPassword = false,
}: {
  initialEmail?: string;
  autoFocusPassword?: boolean;
} = {}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requireCaptcha, setRequireCaptcha] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const userTypedRef = useRef(false);

  const captchaConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Right after verification, browsers (Chrome especially) may either
  // phantom-autofill the password field — visually filled but `.value`
  // still empty — or fill it with a stale saved password from a prior
  // test account. We clear once on mount and again briefly later to
  // catch late autofill, but the delayed clear only fires if the user
  // hasn't started typing — otherwise it would wipe their input.
  useEffect(() => {
    if (!autoFocusPassword) return;
    if (passwordRef.current) passwordRef.current.value = "";
    const t = setTimeout(() => {
      if (!userTypedRef.current && passwordRef.current) {
        passwordRef.current.value = "";
      }
    }, 250);
    return () => clearTimeout(t);
  }, [autoFocusPassword]);

  async function refreshCaptchaRequirement(email: string) {
    if (!captchaConfigured) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      const result = await parseResponse(api.account["login-precheck"].$post({ json: { email: trimmed } }));
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
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    // Honeypot is a hidden checkbox: a checkbox is only present in
    // FormData when checked. Real users can't see or reach it, but
    // bots that blindly fill / tick every field will trip it. We
    // use a checkbox instead of a text input because Chrome's
    // autofill heuristic readily fills text fields with names like
    // "nickname"/"website" from the user's profile, which produced
    // false positives on legitimate logins.
    const honeypotTripped = formData.has("hp_check");

    if (honeypotTripped) {
      setPending(false);
      setError("Invalid email or password, or email not verified");
      return;
    }

    // Distinguish the empty-field case from the wrong-credentials
    // case so the user gets a clear signal instead of a misleading
    // "Invalid email or password". This catches phantom-autofill
    // (visible value, empty `.value`) on the password field too.
    if (!email || !password) {
      setPending(false);
      setError("Please enter your email and password.");
      passwordRef.current?.focus();
      return;
    }

    if (requireCaptcha && !turnstileToken) {
      setPending(false);
      setError("Please complete the CAPTCHA below.");
      return;
    }

    // try/finally so a thrown signIn (network error, unexpected
    // server response) always re-enables the submit button — without
    // this, `pending` stays true and the form looks frozen.
    let result: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      result = await signIn("credentials", {
        email,
        password,
        turnstileToken,
        redirect: false,
      });
    } catch {
      setError("Could not reach the sign-in service. Please try again.");
      setTurnstileToken("");
      setPending(false);
      return;
    } finally {
      setPending(false);
    }

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
      {/* Honeypot — checkbox form. Chrome's autofill heuristic does
          not tick arbitrary hidden checkboxes, so this avoids the
          false positive we hit when this field was a text input
          named "hp_nickname" / "website" (Chrome would autofill it
          with the user's profile nickname and short-circuit login).
          Bots that blindly tick all checkboxes still trip it. */}
      <input
        type="checkbox"
        name="hp_check"
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
          defaultValue={initialEmail}
          onBlur={(e) => refreshCaptchaRequirement(e.currentTarget.value)}
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm mb-1" htmlFor="password">
          Password
        </label>
        <input
          ref={passwordRef}
          type="password"
          id="password"
          name="password"
          required
          // After verification, suppress autofill of saved passwords —
          // the browser frequently fills with a stale value from prior
          // test accounts, and the user has to type fresh anyway.
          autoComplete={autoFocusPassword ? "off" : "current-password"}
          autoFocus={autoFocusPassword}
          onInput={() => {
            userTypedRef.current = true;
          }}
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>
      {captchaConfigured && requireCaptcha && (
        <div>
          <p className="text-xs text-zinc-500 mb-2">Please verify you&rsquo;re not a robot:</p>
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
        <a href="/forgot-password" className="text-zinc-400 hover:text-zinc-300">
          Forgot password?
        </a>
        <a href="/register" className="text-blue-400 hover:underline">
          Create account
        </a>
      </div>
    </form>
  );
}
