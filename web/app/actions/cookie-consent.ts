"use server";

import { cookies } from "next/headers";

import { COOKIE_CONSENT_NAME } from "@/lib/cookie-consent";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function acceptCookieConsentAction(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_CONSENT_NAME, "accepted", {
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
