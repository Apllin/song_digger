"use client";

import { parseResponse } from "hono/client";
import { useState } from "react";

import { api } from "@/lib/hono/client";

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    await parseResponse(api.auth["forgot-password"].$post({ json: { email: String(formData.get("email") ?? "") } }));
    setPending(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="text-center text-sm text-zinc-400">
        If an account exists for that email, we&apos;ve sent a reset link.
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
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
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
