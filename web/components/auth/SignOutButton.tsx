"use client";

import { signOut } from "next-auth/react";

export function SignOutButton({ email }: { email?: string }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      aria-label="Sign out"
      title={`Sign out${email ? ` — ${email}` : ""}`}
      className="w-9 h-9 flex items-center justify-center rounded-full border transition-opacity hover:opacity-85"
      style={{
        background: "rgba(40, 32, 110, 0.82)",
        borderColor: "rgba(216, 200, 255, 0.22)",
        color: "var(--td-fg)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
      }}
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
    </button>
  );
}
