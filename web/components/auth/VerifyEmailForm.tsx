"use client";

import { DetailedError, parseResponse } from "hono/client";
import { useState } from "react";

import { api } from "@/lib/hono/client";

export function VerifyEmailForm({ email }: { email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setResendMsg(null);
    let result;
    try {
      result = await parseResponse(
        api.auth["verify-email"].$post({ json: { email, code: String(formData.get("code") ?? "") } }),
      );
    } catch (err) {
      setPending(false);
      const data = err instanceof DetailedError ? (err.detail?.data as { error?: string } | undefined) : undefined;
      setError(data?.error ?? "Something went wrong. Please try again.");
      return;
    }
    setPending(false);

    if ("error" in result) {
      setError(result.error);
    } else {
      // Hard navigation (not router.push) so the login page mounts with a
      // clean DOM — soft navigation leaves browser autofill in a phantom
      // state where the password field looks filled but the value isn't
      // actually committed, causing the first sign-in attempt to fail.
      // Pass the email through so the user only has to type the password.
      window.location.replace(`/login?verified=true&email=${encodeURIComponent(email)}`);
    }
  }

  async function handleResend() {
    setResendPending(true);
    setResendMsg(null);
    setError(null);
    let result;
    try {
      result = await parseResponse(api.auth["resend-verification"].$post({ json: { email } }));
    } catch (err) {
      setResendPending(false);
      const data = err instanceof DetailedError ? (err.detail?.data as { error?: string } | undefined) : undefined;
      setError(data?.error ?? "Something went wrong. Please try again.");
      return;
    }
    setResendPending(false);
    if ("error" in result) {
      setError(result.error);
    } else {
      setResendMsg("New code sent");
    }
  }

  return (
    <>
      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1" htmlFor="code">
            Verification code
          </label>
          <input
            type="text"
            id="code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-center text-lg tracking-widest"
            placeholder="123456"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {resendMsg && <p className="text-sm text-green-400">{resendMsg}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? "Verifying..." : "Verify email"}
        </button>
      </form>
      <button
        type="button"
        onClick={handleResend}
        disabled={resendPending}
        className="w-full text-sm text-zinc-400 hover:text-zinc-300 disabled:opacity-50"
      >
        {resendPending ? "Sending..." : "Didn't receive code? Resend"}
      </button>
    </>
  );
}
