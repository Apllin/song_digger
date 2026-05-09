"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  retryAfterSeconds: number | null;
  onClose: () => void;
}

function formatRetryTime(seconds: number | null): string {
  if (seconds === null) return "a moment";
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

export function RateLimitModal({ open, retryAfterSeconds, onClose }: Props) {
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
      aria-labelledby="rate-limit-title"
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

        <h2
          id="rate-limit-title"
          className="font-display text-[26px] sm:text-[30px] leading-tight mb-3"
          style={{ letterSpacing: "-0.02em", fontWeight: 600 }}
        >
          You&rsquo;ve hit the limit
        </h2>
        <p className="text-[15px] leading-relaxed mb-7" style={{ color: "var(--td-fg-d)" }}>
          Too many requests in a short time. Your limit resets in{" "}
          <span style={{ color: "var(--td-fg)" }}>{formatRetryTime(retryAfterSeconds)}</span>.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center font-bold text-[14px] transition-colors hover:bg-[rgba(112,132,255,0.08)]"
            style={{
              color: "#ffffff",
              border: "1px solid #7084ff",
              borderRadius: "30px",
              padding: "12px 22px",
              background: "transparent",
            }}
          >
            Wait it out
          </button>
          {/* TODO: link to real pro plan once billing is set up */}
          <button
            type="button"
            onClick={() => alert("Pro plan coming soon!")}
            className="inline-flex w-full items-center justify-center font-bold text-[14px] transition-opacity hover:opacity-90"
            style={{
              color: "#ffffff",
              background: "#4d3ec2",
              border: "1px solid rgba(216, 200, 255, 0.22)",
              borderRadius: "30px",
              padding: "12px 22px",
            }}
          >
            Go Pro — unlimited requests
          </button>
        </div>
      </div>
    </div>
  );
}
