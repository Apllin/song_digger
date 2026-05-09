"use client";

import { parseResponse } from "hono/client";
import { useState, useTransition } from "react";

import { api } from "@/lib/hono/client";

export function CookieConsentBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed) return null;

  const onAccept = () => {
    startTransition(async () => {
      await parseResponse(api.auth["cookie-consent"].$post({}));
      setDismissed(true);
    });
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5 text-td-fg"
        style={{
          background: "var(--td-bg-2)",
          border: "1px solid var(--td-hair-2)",
          boxShadow: "0 18px 50px rgba(0, 0, 0, 0.5)",
        }}
      >
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--td-fg-d)" }}>
          This site uses strictly necessary cookies to authenticate sessions and verify requests. No analytics,
          advertising, or third-party tracking is performed. See our{" "}
          <a
            href="/cookies"
            className="underline transition-colors hover:text-td-fg"
            style={{ color: "var(--td-accent-2)" }}
          >
            Cookie Policy
          </a>{" "}
          for details.
        </p>
        <button
          type="button"
          onClick={onAccept}
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center font-bold text-[13px] transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{
            color: "#ffffff",
            background: "#4d3ec2",
            border: "1px solid rgba(216, 200, 255, 0.22)",
            borderRadius: "30px",
            padding: "10px 20px",
          }}
        >
          {pending ? "..." : "Acknowledge"}
        </button>
      </div>
    </div>
  );
}
