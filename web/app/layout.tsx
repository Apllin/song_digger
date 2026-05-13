import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Raleway } from "next/font/google";
import Script from "next/script";
import { SessionProvider } from "next-auth/react";
import "cal-sans/index.css";
import "./globals.css";

import { AnonymousLimitModalHost } from "@/components/auth/AnonymousLimitModalHost";
import { SessionExpiredHost } from "@/components/auth/SessionExpiredHost";
import { HomeBackground } from "@/components/HomeBackground";
import { Nav } from "@/components/Nav";
import { NavAuthSection } from "@/components/NavAuthSection";
import { NetworkErrorHost } from "@/components/NetworkErrorHost";
import { QueryProvider } from "@/components/QueryProvider";
import { PlayerProvider } from "@/features/player/components/PlayerProvider";
import { auth } from "@/lib/auth";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Geist is the closest free analogue to LaunchDarkly's Söhne — neutral
// grotesque, similar proportions and letter shapes. Used as the primary
// UI typeface (--font-sans) and for the brand wordmark.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

// Raleway — secondary heading typeface from the monopo saigon design
// system. Used selectively (e.g. accent headings) alongside Roobert.
const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Track Digger",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geist.variable} ${geistMono.variable} ${raleway.variable} h-full antialiased`}
    >
      <body className="bg-td-bg">
        <HomeBackground />
        <div className="relative z-10 min-h-full flex flex-col">
          <SessionProvider session={session}>
            <QueryProvider>
              <PlayerProvider>
                <Nav rightSlot={<NavAuthSection />} />
                {children}
                <AnonymousLimitModalHost />
                <NetworkErrorHost />
                <SessionExpiredHost />
              </PlayerProvider>
            </QueryProvider>
          </SessionProvider>
        </div>
        {/* Cloudflare Turnstile (CAPTCHA) — loaded once at the layout
            level so any mounted widget can find window.turnstile.
            Cloudflare requires the script come from this exact URL with
            no proxy/cache, so we use the Script component but let it
            ship as a regular external script. ADR-0021. */}
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
