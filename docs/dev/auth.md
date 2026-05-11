# Authentication

`web/lib/auth.ts`, ADR-0020.

## Overview

Auth.js v5 (`next-auth@beta`) with Credentials provider + JWT sessions, sliding 14-day expiry. Sliding renewal is automatic — every `auth()` call refreshes the cookie expiry; do not add custom rotation logic in callbacks.

## Auth flows

The five auth flows live in `web/app/actions/`: `register.ts`, `verify-email.ts`, `password-reset.ts`. They are Server Actions (not API routes) for native CSRF + simpler form wiring. Each follows a **send-first-then-DB** ordering — Resend's SDK returns `{ data, error }` rather than throwing, so `lib/email.ts` wraps it in a `send()` helper that throws; if the send fails, the action returns an error before any User / VerificationCode / PasswordResetToken row is written, so retry is clean.

- Verification codes: 6 digits, generated with `crypto.randomInt`, stored bcrypt-hashed, 15-minute expiry.
- Reset tokens: 32-byte hex (256 bits), stored plaintext, 1-hour expiry.
- Both flows have built-in 1-minute resend / re-request rate limits via `createdAt` checks.

## Email enumeration

`forgot-password` and the verification resend always succeed silently for nonexistent / verified users. `register` does leak existence ("Email already registered") — deliberate UX trade.

## Auth helpers

`requireUser()` / `getCurrentUser()` in [web/lib/auth-utils.ts](../../web/lib/auth-utils.ts). `requireUser` throws `Error("UNAUTHORIZED")`; the per-route 401 wrapping is the caller's responsibility.

## Admin pre-claim pattern

Migration `20260504215611_add_authentication_schema` inserts a `User` row with id `admin_seed_account_id` and no passwordHash, and backfills existing favorites / dislikes to it. Registration with that email "claims" the row by setting passwordHash, so the existing data becomes the new user's data. Don't re-litigate this without rereading ADR-0020.

## UI surface

`/register`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, plus `<NavAuthSection />` in the layout. Because the layout calls `auth()`, every route is server-rendered per request — there is no static prerender for the page body.
