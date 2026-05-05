import type { NextConfig } from "next";

// CSP whitelist. Each directive is its own string for readability;
// joined with "; " before being sent. See ADR-0021.
const cspDirectives = [
  // Default deny everything not explicitly listed below.
  "default-src 'self'",

  // Next.js App Router emits inline scripts for hydration and uses
  // eval-style transforms in dev — 'unsafe-inline' / 'unsafe-eval'
  // are unavoidable. Cloudflare Turnstile loads from challenges.cloudflare.com.
  // www.youtube.com hosts the IFrame Player API script that BottomPlayer /
  // EmbedPlayer inject at runtime — without it the player hangs on "loading".
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.youtube.com",

  // Inline styles come from Tailwind's hashed classes plus framework
  // injected styles; can't be tightened without a code change.
  "style-src 'self' 'unsafe-inline'",

  // Album art comes from many CDNs (Bandcamp, YouTube thumbnails,
  // Cosine, Yandex, etc.). HTTPS-only any source is the practical
  // bound; data: covers placeholder URIs.
  "img-src 'self' https: data:",

  "font-src 'self' data:",

  // Outgoing fetch destinations: same-origin API + Cloudflare's
  // Turnstile challenge domain (the widget posts back to it).
  "connect-src 'self' https://challenges.cloudflare.com",

  // Embedded iframes the app actually mounts.
  // - youtube.com/embed (BottomPlayer + EmbedPlayer for YT)
  // - bandcamp.com EmbeddedPlayer
  // - challenges.cloudflare.com (Turnstile widget renders inside an iframe)
  // music.yandex.* is reachable via Discogs links but not rendered
  // as an iframe today; if that changes, add it here.
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://bandcamp.com https://challenges.cloudflare.com",

  // Where forms can submit. Anything cross-origin is suspicious for
  // this app — auth flows post to /api/auth/* same-origin.
  "form-action 'self'",

  "base-uri 'self'",

  // Hard prohibit being embedded in a frame anywhere; clickjacking
  // defense in depth alongside X-Frame-Options.
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  // HSTS: production only — dev runs on plain HTTP and the header
  // would force browsers to upgrade to HTTPS, breaking localhost.
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),

  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: cspDirectives },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
