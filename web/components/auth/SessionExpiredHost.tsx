"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";

import { apiEvents } from "@/lib/apiEvents";

export function SessionExpiredHost() {
  useEffect(() => apiEvents.on("error:session-expired", () => signOut({ redirect: true, callbackUrl: "/login" })), []);
  return null;
}
