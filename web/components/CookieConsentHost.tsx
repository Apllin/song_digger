import { cookies } from "next/headers";
import { COOKIE_CONSENT_NAME } from "@/lib/cookie-consent";
import { CookieConsentBanner } from "./CookieConsentBanner";

export async function CookieConsentHost() {
  const store = await cookies();
  if (store.get(COOKIE_CONSENT_NAME)?.value === "accepted") return null;
  return <CookieConsentBanner />;
}
