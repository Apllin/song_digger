"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Shown when an anonymous user hits the 10-request pool limit. Blocks
// further interaction with results until they register, sign in, or
// dismiss. ADR-0021.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="register-prompt-title"
    >
      <div
        className="relative w-full max-w-sm rounded-lg bg-zinc-900 border border-zinc-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="register-prompt-title"
          className="text-xl font-semibold mb-2 text-zinc-100"
        >
          Sign up to keep digging
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          You&rsquo;ve used your 10 free searches. Create a free account to keep
          exploring music &mdash; plus you&rsquo;ll be able to save favorites and
          dislike tracks you don&rsquo;t want to see again.
        </p>
        <div className="space-y-2">
          <a
            href="/register"
            className="block w-full text-center rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Create free account
          </a>
          <a
            href="/login"
            className="block w-full text-center rounded-md border border-zinc-700 hover:bg-zinc-800 px-4 py-2 text-sm text-zinc-200 transition-colors"
          >
            Already have an account? Sign in
          </a>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300"
          aria-label="Close"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
