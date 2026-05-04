"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordAction } from "@/app/actions/password-reset";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("token", token);
    const result = await resetPasswordAction(formData);
    setPending(false);

    if ("error" in result) {
      setError(result.error);
    } else {
      router.push("/login?verified=true");
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1" htmlFor="password">
          New password
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
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
