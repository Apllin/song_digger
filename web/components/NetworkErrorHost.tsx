"use client";

import { useEffect } from "react";

import { apiEvents } from "@/lib/apiEvents";

// TODO: replace alert with a dedicated modal once shadcn is integrated.
export function NetworkErrorHost() {
  useEffect(
    () => apiEvents.on("error:network", () => alert("Network error — check your connection and try again.")),
    [],
  );

  return null;
}
