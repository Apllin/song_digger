"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
    });
    setPending(false);

    // Generic error — don't reveal whether the email exists, the password
    // is wrong, or the email isn't verified.
    if (!result || result.error) {
      setError("Invalid email or password, or email not verified");
      return;
    }

    router.push("/");
    // Refresh so server components (nav, etc.) see the new session cookie.
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          autoComplete="current-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm"
        />
      </div>
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
