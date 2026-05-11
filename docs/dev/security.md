# Security

`web/lib/{anonymous-counter,brute-force,turnstile}.ts`, `next.config.ts`, ADR-0021.

## Anonymous request limit

Per-IP counter (`AnonymousRequest`) gates `/api/search`, `/api/discography/search`, `/api/discography/label/search`. 10 free requests pooled across them; 11th returns `429 ANONYMOUS_LIMIT_REACHED`. Authenticated users bypass.

Server-side: [`anonGate` Hono middleware](../../web/lib/hono/anonGate.ts), mounted on those three routes.  
Client-side: [`withAnonGate`](../../web/lib/with-anon-gate.ts) wraps the typed `parseResponse(...)` promise — converts a `DetailedError` with `{ error: "ANONYMOUS_LIMIT_REACHED" }` into a call to `setShowRegisterPrompt(true)` returning `null`. `<AnonymousLimitModalHost />` (mounted in root layout) reads `showRegisterPromptAtom`.

Don't add the gate to follow-up calls (releases / tracklist / embed) — it's for typed-search entry points only.

## Cloudflare Turnstile

`lib/turnstile.ts` calls `siteverify` and **fails closed** on missing secret, network errors, non-2xx, or empty token. Don't add fail-open paths — bypassing CAPTCHA on infra failure is the attack vector. The api.js script is loaded once at the layout level via `next/script`. Test keys are `1x00...AA` (always-pass) and `2x...AB` (always-fail) — publicly documented, safe to commit.

## Brute-force layers

In `authorize()` in `lib/auth.ts`, ordered cheapest-first:

1. **Per-IP rate limit** — 10 failed attempts in 15 min throws `RateLimitError` (CredentialsSignin subclass with `code: "RATE_LIMIT"`).
2. **CAPTCHA gate** — required after 3 failed attempts on the email; verified before the bcrypt compare.
3. **Per-email exponential backoff** — 0/0/1s/4s/16s/64s. Sleeps inside `authorize()`. **Vercel free tier (10s function timeout) will time out at the 64s tier** — production deployments need 90s+.
4. **Email warning** at 5+ failed attempts (only for accounts that exist).

Successful login calls `clearFailedAttempts(email)`; the per-IP counter is unaffected.

Login form asks the server (`loginPrecheckAction`) on email blur whether CAPTCHA is required; server is the source of truth. Constants live in `BRUTE_FORCE_CONSTANTS` in `lib/brute-force.ts` — change them there, not inline.

## CSP

Strict allowlists in `next.config.ts`. Adding a new iframe source means adding its host to `frame-src`. CSP violations show up in DevTools Console — check there before assuming a feature is broken. `'unsafe-inline'` / `'unsafe-eval'` on `script-src` are unavoidable due to Next.js inline hydration scripts.

## Honeypot fields

Hidden `website` input on register and login. When non-empty, the action returns fake success without DB writes — bot sees no signal it was detected.

## Input validation

Every API entry point that reads user input passes through Zod with length caps. When adding a new route, add a schema — don't trust strings.
