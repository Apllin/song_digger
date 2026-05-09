"use client";

import { useEffect, useState } from "react";
import { RateLimitModal } from "./RateLimitModal";

import { apiEvents } from "@/lib/apiEvents";

export function RateLimitModalHost() {
  const [state, setState] = useState<{ open: boolean; retryAfterSeconds: number | null }>({
    open: false,
    retryAfterSeconds: null,
  });

  useEffect(
    () => apiEvents.on("error:rate-limit", ({ retryAfterSeconds }) => setState({ open: true, retryAfterSeconds })),
    [],
  );

  return (
    <RateLimitModal
      open={state.open}
      retryAfterSeconds={state.retryAfterSeconds}
      onClose={() => setState((prev) => ({ ...prev, open: false }))}
    />
  );
}
