"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Shown when an anonymous user hits the ANON_LIMIT-request pool. Blocks
// further interaction with results until they register, sign in, or
// dismiss. ADR-0021. Styled to match the /login card (--td-bg-2 + hair
// border) and the nav's Sign in / Sign up button treatments.
export function RegisterPromptModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-prompt-title"
    >
      <div
        className="relative w-full max-w-md rounded-xl p-7 sm:p-9 text-td-fg"
        style={{
          background: "var(--td-bg-2)",
          border: "1px solid var(--td-hair-2)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="register-prompt-title"
          className="font-display text-[26px] sm:text-[30px] leading-tight mb-3"
          style={{ letterSpacing: "-0.02em", fontWeight: 600 }}
        >
          Sign up to keep digging
        </h2>
        <p className="text-[15px] leading-relaxed mb-7" style={{ color: "var(--td-fg-d)" }}>
          You&rsquo;ve used your 5&nbsp;free searches. Create a free account to
          keep exploring music &mdash; you&rsquo;ll be able to save
          favorite tracks and much more.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="/register"
            className="inline-flex w-full items-center justify-center font-bold text-[14px] transition-opacity hover:opacity-90"
            style={{
              color: "#ffffff",
              background: "#4d3ec2",
              border: "1px solid rgba(216, 200, 255, 0.22)",
              borderRadius: "30px",
              padding: "12px 22px",
            }}
          >
            Create free account
          </a>
          <a
            href="/login"
            className="inline-flex w-full items-center justify-center font-bold text-[14px] transition-colors hover:bg-[rgba(112,132,255,0.08)]"
            style={{
              color: "#ffffff",
              border: "1px solid #7084ff",
              borderRadius: "30px",
              padding: "12px 22px",
              background: "transparent",
            }}
          >
            Already have an account? Sign in
          </a>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-[rgba(255,255,255,0.06)]"
          style={{ color: "var(--td-fg-m)" }}
          aria-label="Close"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
