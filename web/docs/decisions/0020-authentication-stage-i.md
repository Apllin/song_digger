# 0020 — Authentication (Auth.js v5, Stage I)

**Date:** 2026-05-05
**Status:** Accepted

**Context:**
Pre-Stage I, the project had no concept of users. Favorites and
disliked tracks were table-scoped (`Favorite.trackId @unique`,
`DislikedTrack` keyed by `(artistKey, titleKey)`) — every visitor
shared the same set, which only worked because the project had a
single user. Moving toward a public launch made per-user scoping
unavoidable: the dislike list of one visitor must not filter the
search results of another, and favorites have to belong to whoever
set them.

The user committed to email/password authentication with 6-digit
email verification codes (not magic links — easier on mobile and
doesn't require the user to switch back to the originating tab).
OAuth providers were declined for Stage I; the surface area of the
auth flows alone was already large enough.

**Decision:**

- **Auth.js v5** (`next-auth@5.0.0-beta.31`) as the auth framework,
  with the `@auth/prisma-adapter` wired in even though Credentials +
  JWT doesn't actually use it. The adapter is there so a future OAuth
  provider can persist `Account` / `Session` rows without a config
  change.

- **JWT sessions, 14-day sliding expiry.** Auth.js refreshes the
  cookie on every `auth()` call automatically — no custom rotation
  logic. Database sessions weren't viable: the Credentials provider
  only officially supports JWT.

- **6-digit code email verification, manual implementation via the
  Resend SDK.** The Auth.js Resend provider only supports magic
  links, so registration / verification / password reset are written
  as Server Actions that call `resend.emails.send` directly.
  Codes are generated with `crypto.randomInt` (not `Math.random` —
  6-digit codes only have ~20 bits of entropy and a non-CSPRNG would
  make them predictable from timing) and stored bcrypt-hashed with a
  15-minute expiry.

- **Email-only identifier.** No separate username field; the email
  is the canonical user handle. Lowercased on every read and write
  to avoid `Mixed@Example.com` and `mixed@example.com` becoming
  separate rows.

- **Server Actions** (not API routes) for register, verify, resend,
  forgot-password, reset-password. Server Actions get CSRF protection
  natively in Next.js, the form / action shape is simpler, and the
  client doesn't need to reach for `fetch`.

- **`authorize()` returns null on every failure mode** — invalid
  credentials, missing user, missing passwordHash, unverified email,
  bcrypt mismatch all collapse to `null`. The spec originally called
  for `throw new Error("EMAIL_NOT_VERIFIED")` for the unverified
  case, but Auth.js v5 docs state that only `null` or a thrown
  `CredentialsSignin` propagates as a clean user error; a generic
  `Error` becomes an internal failure. The login UI shows a single
  generic message regardless ("Invalid email or password, or email
  not verified") so the differentiation was never user-visible.

- **Send-first ordering** in register, verify-resend, and
  forgot-password actions. The Resend SDK returns `{ data, error }`
  rather than throwing on API failure; an internal `send()` helper
  in `lib/email.ts` checks `error` and throws so the action sees a
  real failure. Each action then sends the email *before* writing to
  the DB. If Resend fails (free-tier sandbox restrictions, unverified
  domain, transient errors), no `User` claim, no `VerificationCode`,
  no `PasswordResetToken` is left dangling — the user can simply
  retry. forgot-password additionally swallows any send failure into
  the same silent success it already returns for nonexistent users,
  so timing analysis doesn't reveal whether the address is
  registered.

- **Migration option A: admin pre-claim row.** The migration
  `20260504215611_add_authentication_schema` inserts one `User` row
  with id `admin_seed_account_id` and email `daebatzaebis@gmail.com`,
  no `passwordHash`, no `emailVerified`. All existing 10 favorites
  and 32 dislikes are backfilled to that userId. When the user later
  registers with that email, registration takes a "claim" path: it
  detects the existing row (passwordHash null), updates it with the
  new passwordHash and code, and the favorites / dislikes are
  transparently theirs. New emails go through normal create.

- **Reset tokens stored plaintext.** 32 bytes (256 bits) of entropy
  carry the security; bcrypt-hashing a 32-byte token would add ~80ms
  per lookup without adding meaningful entropy. Verification codes
  are different — 6 digits is low enough entropy that the bcrypt cost
  helps, even if marginally.

- **Anonymous users keep using the search.** `/api/search` reads
  the authenticated user's dislikes when a session cookie is
  present, otherwise an empty set (no filter). Anonymous users
  don't see ♥ or ✕ buttons on track cards. Anonymous request limits
  and a register prompt come in Stage J.

**Consequences:**

- Five new tables (`User`, `Account`, `Session`,
  `VerificationCode`, `PasswordResetToken`) plus `userId` on
  `Favorite` and `DislikedTrack`. The unique constraint on
  `Favorite.trackId` becomes `(userId, trackId)`, and the unique on
  `DislikedTrack(artistKey, titleKey)` becomes
  `(userId, artistKey, titleKey)`. The hand-written migration
  backfills `userId` to the admin seed row before adding the
  `NOT NULL` constraint — `prisma migrate dev` would have refused
  the auto-generated SQL.

- `/api/favorites`, `/api/dislikes`, and `/api/search`'s dislike
  query are scoped to `requireUser()`. Anonymous calls to the first
  two return 401. Step 1 of this stage temporarily pinned these
  routes to the admin seed userId so each commit between schema
  creation (Step 1) and per-user wiring (Step 8) was individually
  buildable; Step 8 swapped the pin out.

- Sliding renewal works automatically — the cookie's expiry is
  refreshed every time `auth()` is called. No custom rotation logic
  in callbacks. Trying to add one tends to silently break it.

- `auth()` in `app/layout.tsx` (via `<NavAuthSection />`) reads the
  session cookie at request time, which marks every route as
  dynamic — `/`, `/register`, `/labels`, `/discography` used to be
  static prerendered. Acceptable for Stage I; Stage K can revisit by
  moving the auth section to a client component using
  `next-auth/react getSession()` if static prerender of page bodies
  matters for production.

- Email enumeration is blocked on `forgot-password` and the
  verification resend flow (always succeed silently when the email
  isn't registered). It is *not* blocked on `register` — that one
  responds "Email already registered", which leaks existence. This
  is a deliberate UX trade: the alternative (silently succeed on a
  taken email) confuses legitimate signups. Common pattern, accepted
  risk.

- Verification + password-reset flow have a built-in 1-minute rate
  limit per email, enforced via `createdAt` on the latest token row.
  Stage K handles per-IP and global rate limiting at the gateway.

- No "sign out from all devices" feature. Would require database
  sessions (Stage K decision, not Stage I).

- Account deletion is not implemented. Required for EU launch (GDPR);
  deferred to Stage K.

**Alternatives considered:**

- **Lucia / custom session implementation.** Rejected — Auth.js v5
  handles JWT signing, cookie management, CSRF, and the route handler
  contract. Replacing it with hand-rolled code adds maintenance for
  no clear win on this surface area.

- **Database sessions.** Rejected by Auth.js — the Credentials
  provider is JWT-only by design.

- **Magic-link verification (Auth.js Resend provider).** Rejected by
  the user's product call — codes work better on mobile (no tab
  switching, paste-friendly) and don't break if the email arrives on
  a different device than where the user started the flow.

- **Argon2 instead of bcrypt.** Rejected for installation friction
  (native bindings fail on some platforms). bcryptjs is pure JS, fine
  for launch. Stage K can revisit if password hashing becomes a hot
  path.

- **OAuth (Google, Apple) in Stage I.** Rejected by the user — kept
  the surface area narrow. The `@auth/prisma-adapter` is wired so
  adding a provider later is a config change, not a refactor. Stage K
  candidate.

- **Strict no-enumeration on register.** Rejected — would have to
  always return success even on a taken email, and the legitimate
  signup couldn't tell the difference between "your account was
  created, check your inbox" and "this email is already registered,
  try signing in or reset password." UX cost outweighs the
  enumeration leak (which is already a Stage K rate-limit problem).
