"use client";

import { useEffect, useRef } from "react";

interface Props {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  /** Action label for Cloudflare analytics (e.g., "register", "login"). */
  action?: string;
  theme?: "auto" | "light" | "dark";
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement | string,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          action?: string;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

// Explicit-render Turnstile widget. The api.js script is loaded once
// from the root layout via next/script. We poll the global a few
// times in case render mounts before the script finishes loading.
// ADR-0021.
export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  action,
  theme = "auto",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest callbacks in refs so the effect doesn't re-render
  // (and re-mount) the widget every keystroke in the parent form.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  useEffect(() => {
    const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey || !containerRef.current) return;

    const el = containerRef.current;
    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const render = () => {
      if (cancelled || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey,
        callback: (token) => onVerifyRef.current(token),
        "expired-callback": () => onExpireRef.current?.(),
        "error-callback": () => onErrorRef.current?.(),
        action,
        theme,
      });
    };

    if (window.turnstile) {
      render();
    } else {
      pollHandle = setInterval(() => {
        if (window.turnstile) {
          if (pollHandle) clearInterval(pollHandle);
          pollHandle = null;
          render();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Cloudflare can throw if the widget is already gone; ignore.
        }
        widgetIdRef.current = null;
      }
    };
  }, [action, theme]);

  return <div ref={containerRef} />;
}
