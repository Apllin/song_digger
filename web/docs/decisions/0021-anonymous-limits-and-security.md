# 0021 — Anonymous request limits, CAPTCHA, brute-force protection, security headers

**Date:** 2026-05-05
**Status:** Accepted

**Context:**
Stage I (ADR-0020) shipped authentication. Stage J locks down the
auth surface and the anonymous request path before public launch.
Without these layers a registered-only product still has three
exposures: (a) anonymous traffic could grind the search pipeline
indefinitely, since /api/search has no per-IP cost; (b) the login
form is a free password-spray target; (c) the app sets no security
headers, leaving easy XSS / clickjacking footholds for any
third-party content rendered through embeds.

The user committed to Cloudflare Turnstile rather than a hand-rolled
CAPTCHA or hCaptcha, to PostgreSQL-backed counters rather than Redis
(simpler — Stage K can move to Redis if traffic justifies), and to
strict CSP with explicit allowlists rather than a permissive
"https: \*" baseline.

**Decision:**

- **Anonymous request counter.** A new `AnonymousRequest` table
  (`ip` unique, `count`, `firstAt`, `lastAt`) tracks per-IP
  unauthenticated requests across `/api/search`, `/api/discography/search`,
  and `/api/discography/label/search`. The first 10 requests pass
  through; the 11th returns `429 ANONYMOUS_LIMIT_REACHED`. The
  client (search / discography / labels pages) detects the body via
  `fetchWithAnonGate` and sets a Jotai atom (`showRegisterPromptAtom`)
  read by `<AnonymousLimitModalHost />` mounted in the root layout
  — one shared modal, no per-page duplication. Authenticated users
  bypass the counter entirely. The counter is persistent — there is
  no decay window — until the user registers; Stage K may add a
  cleanup job if the table grows unwieldy.

- **Cloudflare Turnstile CAPTCHA.** Server-side verification via
  `lib/turnstile.ts` calls `https://challenges.cloudflare.com/turnstile/v0/siteverify`
  with `secret`, `response`, and (when known) `remoteip`. The
  verifier fails closed on missing secret, network errors, non-2xx
  responses, and empty tokens — fail-open here would be the attack
  vector. A client widget (`<TurnstileWidget />`) renders explicitly
  via the api.js script loaded once at the layout level; stable
  callback refs prevent re-mounting on every parent render. The
  widget is gated by `NEXT_PUBLIC_TURNSTILE_SITE_KEY` so dev
  environments without keys still let registration through.
  Required on `/register` always, and on `/login` after 3 failed
  attempts on the same email.

- **Brute-force protection (4 layers).** A new `LoginAttempt` table
  records every attempt (`ip`, nullable `email`, `success`,
  `createdAt`).
  Layer 1 — per-IP rate limit: 10 failed attempts in any 15-minute
  window throws `RateLimitError` (CredentialsSignin subclass) before
  any expensive work. Successes don't tick the counter so a working
  user holding Enter never locks themselves out.
  Layer 2 — per-email exponential backoff: 0/0/1s/4s/16s/64s for
  attempts 1..5+. Sleeps inside `authorize()` so the form-side UX
  stays a single "submit takes a while" rather than a separate
  state machine. The 64s tier requires the deployment platform's
  function timeout to exceed it — Vercel free tier (10s) does not,
  flagged below.
  Layer 3 — adaptive CAPTCHA: required on login after the email's
  failed-count reaches 3 in the lookback window. The login form
  asks the server (via the `loginPrecheckAction` Server Action)
  rather than tracking client-side state, so the threshold is
  enforced even if the form is bypassed.
  Layer 4 — security email warning: fires exactly once when the
  current attempt crosses the 5-failure threshold, only for
  accounts that exist. Non-existent emails leak nothing on the
  sender side. On successful login, `clearFailedAttempts(email)`
  drops the email's failed history (the per-IP counter is
  unaffected — it counts attacks, not user mistakes).

- **Security headers.** `next.config.ts` `headers()` emits, for
  every route:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (production only — dev runs HTTP)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
  - `Content-Security-Policy` with explicit allowlists per directive

- **Strict CSP allowlists.** `default-src 'self'`. Per-directive
  exceptions match the surface the app actually uses:
  - `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com` — Next.js App Router emits inline scripts and dev uses eval-style transforms, so `'unsafe-inline'` / `'unsafe-eval'` are unavoidable
  - `frame-src` includes only domains we render iframes from: youtube.com/embed, youtube-nocookie, bandcamp.com, challenges.cloudflare.com (Turnstile widget)
  - `img-src 'self' https: data:` — album art is served from many CDNs (Bandcamp, YouTube thumbs, Cosine, Yandex), so HTTPS-any is the practical bound
  - `connect-src 'self' https://challenges.cloudflare.com` — siteverify and challenge POSTs
  - `form-action 'self'`, `base-uri 'self'`, `frame-ancestors 'none'`

- **Input validation audit.** Every API entry point that reads
  user-controlled input now passes through Zod. /api/dislikes,
  /api/favorites DELETE, /api/discography/{search,releases,
  tracklist,label/search,label/releases,embed}, /api/play-lookup,
  /api/suggestions all gained schemas. Numeric IDs are coerced to
  positive ints with hard upper bounds; query strings are length-
  capped (200 chars for search inputs, 500 for artist/title).

- **Honeypot fields** on register and login: a hidden `website`
  text input (off-screen, no tab stop, `aria-hidden`). When the
  field is non-empty, the action returns a fake success without
  any DB write or email send — the bot sees no signal it was
  detected. Real users can't fill it.

**Consequences:**

- Anonymous traffic is now a finite cost per IP. Rolling out
  globally without WAF is no longer reckless. The flip side:
  shared NATs (university dorms, large offices) can hit the limit
  legitimately. Acceptable for launch — Stage K may move to a
  rolling window or per-session counter if support requests come in.

- Brute-force economics are flipped. With 64s backoff after the 4th
  attempt, a single email at 5+ failures takes ~85s of attacker
  wall-clock per try. Per-IP rate limit caps a hostile network at
  10/15min. CAPTCHA at 3 emails the user something an attacker
  cannot intercept. Combined cost makes online password-spray
  uneconomical against the low-entropy 8-char minimum.

- The `/api/auth/*` route now needs >64s function timeout in
  production. Vercel free tier (10s) will time out. Configure 90s
  in `vercel.json` or use a longer-timeout plan; alternatively, drop
  the 64s tier in code (the constant lives in `lib/brute-force.ts`).

- IP detection relies on `x-forwarded-for` / `x-real-ip` set by the
  reverse proxy. On bare Node.js without a proxy, the headers can
  be spoofed and the entire counter scheme falls back to a single
  shared "unknown" bucket. Documented as a deployment requirement
  — Vercel and Cloudflare both set the headers correctly.

- Strict CSP can break embeds. New iframe sources (e.g., adding
  Yandex embeds in a future stage) require an explicit `frame-src`
  entry. CSP violations show up in DevTools Console; check there
  before assuming a feature is broken.

- The Turnstile script is loaded site-wide (one network request per
  page load). Acceptable — it's < 50KB cached — but worth revisiting
  if a future page never needs CAPTCHA.

- Email enumeration via the CAPTCHA-required signal is mitigated by
  recording attempts against IP+email regardless of whether the
  email exists. The threshold check counts both the same, so "did
  CAPTCHA appear" doesn't reveal account existence. The
  `register` action still leaks existence (per ADR-0020 — UX trade).

- CSP violation reporting is not configured. Stage K can wire up
  `Content-Security-Policy-Report-Only` headers or a SIEM endpoint
  if real-world violations need monitoring.

**Alternatives considered:**

- **Hard account lockout after N failed attempts.** Rejected —
  trivially turns into a denial-of-service against a known target
  (e.g., the admin email). Exponential backoff plus CAPTCHA hits
  the attacker without locking the legitimate user out.

- **In-memory rate-limiting (e.g., a Map keyed by IP).** Rejected
  — lost on every server restart, doesn't survive horizontal scale,
  doesn't survive deploys. The Postgres counters are slower but
  correct. Stage K can move to Redis when sub-millisecond reads
  become a bottleneck.

- **hCaptcha / Google reCAPTCHA.** Rejected. hCaptcha has a similar
  privacy posture but worse free tier; reCAPTCHA v3 introduces a
  Google dependency that's hostile to EU users. Turnstile is free,
  no-tracking, and Cloudflare-operated.

- **Permissive CSP `https:`.** Rejected — defeats the purpose. The
  whole point of CSP is the explicit allowlist. The current strict
  list is small enough to maintain.

- **2FA (TOTP).** Rejected for launch. Music discovery doesn't
  warrant the friction. Stage K candidate if/when an account-level
  feature (paid tier, playlist sharing) needs it.

- **WAF / Cloudflare Bot Management at the edge.** Deferred to
  Stage L (deploy). The application-level layers are sufficient to
  ship; edge protection is additive, not foundational.

- **Anonymous counter that decays after 30 days.** Rejected for
  launch — adds a job, hides product feedback. The persistent
  counter is the simpler default; cleanup can ship in Stage K if
  warranted.
