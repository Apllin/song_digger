import { cookies } from "next/headers";
import { CookieConsentBanner } from "./CookieConsentBanner";

import { COOKIE_CONSENT_NAME } from "@/lib/cookie-consent";

export async function CookieConsentHost() {
  const store = await cookies();
  if (store.get(COOKIE_CONSENT_NAME)?.value === "accepted") return null;
  return <CookieConsentBanner />;
}
