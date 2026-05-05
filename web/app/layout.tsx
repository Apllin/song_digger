import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { NavAuthSection } from "@/components/NavAuthSection";
import { PlayerProvider } from "@/components/PlayerProvider";
import { AnonymousLimitModalHost } from "@/components/auth/AnonymousLimitModalHost";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Track Digger",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950">
        <PlayerProvider>
          <Nav rightSlot={<NavAuthSection />} />
          {children}
          <AnonymousLimitModalHost />
        </PlayerProvider>
        {/* Cloudflare Turnstile (CAPTCHA) — loaded once at the layout
            level so any mounted widget can find window.turnstile.
            Cloudflare requires the script come from this exact URL with
            no proxy/cache, so we use the Script component but let it
            ship as a regular external script. ADR-0021. */}
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
