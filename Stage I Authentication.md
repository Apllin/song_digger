# Stage I — Authentication core (Auth.js v5)

> **Goal**: Implement email/password authentication using Auth.js v5
> with sliding 14-day JWT sessions, 6-digit code email verification,
> password reset via email, and per-user favorites/dislikes.
>
> **Scope**: Authentication infrastructure only. Anonymous request
> limits and CAPTCHA come in Stage J. OAuth providers are NOT
> implemented (user explicitly declined).
>
> **Prerequisites**:
> - Stage H committed and pushed (last commit: `ca5fc01 docs: cleanup
>   post-Stage-H`)
> - Working tree clean, origin synced
> - Resend account created at https://resend.com — get API key
>   (free tier covers dev/launch)
> - Skills loaded: `prisma-transaction`, `adr-writing`

---

## Operating mode for this stage

You (Claude) lead this stage. The user is not in the loop between
commits, but Stage I is large (10 commits) — there are 3 mandatory
check-in points where you STOP and wait for user review before
continuing. These are noted explicitly in steps 4, 6, and 8.

When uncertain on implementation, look at how Auth.js v5 docs
recommend it (https://authjs.dev). Don't guess at API shape — read
the docs.

When uncertain on a business question — ask the user.

---

## Architectural decisions (do not re-litigate)

User has confirmed:

1. **Auth.js v5** (`next-auth@beta`) for session/auth handling
2. **JWT sessions** with sliding 14-day renewal (automatic via
   Auth.js `auth()` calls)
3. **6-digit code** email verification (NOT magic link) — manual
   implementation via Resend SDK direct (NOT Auth.js Resend
   provider, which only does magic links)
4. **Email-only** identifier (no separate username field)
5. **English** for all UI text and email content
6. **Server Actions** for register/verify/forgot/reset (NOT API
   routes — Server Actions handle CSRF natively in Next.js)
7. **Resend** for transactional emails, `onboarding@resend.dev`
   sender for now (will swap to user's domain later via
   `EMAIL_FROM` env var)
8. **Migration option A**: pre-create admin account with email
   `daebatzaebis@gmail.com` and migrate existing 9 favorites + 30
   dislikes to its userId. When user registers with same email,
   account "claims" the data by setting passwordHash + emailVerified.

---

## Step 1 — Schema migration

Add the auth tables required by Auth.js v5 Prisma adapter, plus
custom tables for verification codes and password reset, plus
userId on Favorite and DislikedTrack.

### Schema changes

`web/prisma/schema.prisma` — add these models:

```prisma
model User {
  id                String    @id @default(cuid())
  email             String    @unique
  emailVerified     DateTime?  // null = not verified, timestamp = verified
  passwordHash      String?    // null = OAuth-only or pre-claim admin
  name              String?
  image             String?    // OAuth profile image, null for credentials users
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  accounts          Account[]
  sessions          Session[]
  favorites         Favorite[]
  dislikedTracks    DislikedTrack[]

  @@index([email])
}

// Required by Auth.js Prisma adapter (used for future OAuth)
model Account {
  id                String   @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?  @db.Text
  access_token      String?  @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?  @db.Text
  session_state     String?

  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

// Required by Auth.js adapter even for JWT sessions
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Email verification codes (6-digit, expires in 15 minutes, hashed)
model VerificationCode {
  id        String   @id @default(cuid())
  email     String
  code      String   // bcrypt hash of the 6-digit code
  expires   DateTime
  createdAt DateTime @default(now())

  @@index([email])
}

// Password reset tokens (32-byte hex, expires in 1 hour)
model PasswordResetToken {
  id        String   @id @default(cuid())
  email     String
  token     String   @unique
  expires   DateTime
  createdAt DateTime @default(now())

  @@index([email])
}
```

### Existing tables — add userId

`Favorite`:

```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String   // NEW
  trackId   String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  track     Track    @relation(fields: [trackId], references: [id], onDelete: Cascade)

  @@unique([userId, trackId])  // changed from trackId @unique
  @@index([userId])
}
```

`DislikedTrack`:

```prisma
model DislikedTrack {
  id        String   @id @default(cuid())
  userId    String   // NEW
  artistKey String
  titleKey  String
  artist    String
  title     String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, artistKey, titleKey])
  @@index([userId, artistKey])
}
```

### Migration SQL (write by hand)

Prisma's auto migration may struggle with constraint changes. Write
the migration SQL manually and apply via `prisma migrate deploy`:

```sql
-- 1. Create User, Account, Session, VerificationCode, PasswordResetToken
-- (Prisma generates the CREATE TABLE statements from schema)

-- 2. Insert admin pre-create row with user-provided email
INSERT INTO "User" (id, email, "emailVerified", "passwordHash", "createdAt", "updatedAt")
VALUES (
  'admin_seed_account_id',
  'daebatzaebis@gmail.com',
  NULL,
  NULL,
  NOW(),
  NOW()
);

-- 3. Add userId to Favorite, populate, then constrain
ALTER TABLE "Favorite" ADD COLUMN "userId" TEXT;
UPDATE "Favorite" SET "userId" = 'admin_seed_account_id';
ALTER TABLE "Favorite" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "Favorite" DROP CONSTRAINT "Favorite_trackId_key";
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_trackId_key" UNIQUE ("userId", "trackId");
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- 4. Same for DislikedTrack
ALTER TABLE "DislikedTrack" ADD COLUMN "userId" TEXT;
UPDATE "DislikedTrack" SET "userId" = 'admin_seed_account_id';
ALTER TABLE "DislikedTrack" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "DislikedTrack" DROP CONSTRAINT "DislikedTrack_artistKey_titleKey_key";
ALTER TABLE "DislikedTrack" ADD CONSTRAINT "DislikedTrack_userId_artistKey_titleKey_key"
  UNIQUE ("userId", "artistKey", "titleKey");
ALTER TABLE "DislikedTrack" ADD CONSTRAINT "DislikedTrack_userId_fkey" FOREIGN KEY ("userId")
  REFERENCES "User"("id") ON DELETE CASCADE;
DROP INDEX IF EXISTS "DislikedTrack_artistKey_idx";
CREATE INDEX "DislikedTrack_userId_artistKey_idx" ON "DislikedTrack"("userId", "artistKey");
```

Run via:
```bash
cd web
pnpm exec prisma migrate dev --name add_authentication_schema
```

If interactive prompts about data loss appear, follow Stage F's
pattern: write SQL by hand under `prisma/migrations/<ts>_*/migration.sql`
and apply via `prisma migrate deploy`.

### Verify

```bash
pnpm exec prisma migrate status
psql $DATABASE_URL -c "SELECT id, email FROM \"User\";"
psql $DATABASE_URL -c "SELECT \"userId\", COUNT(*) FROM \"Favorite\" GROUP BY \"userId\";"
psql $DATABASE_URL -c "SELECT \"userId\", COUNT(*) FROM \"DislikedTrack\" GROUP BY \"userId\";"
```

Expected: User row with admin_seed_account_id, 9 favorites and 30
dislikes attached to it.

### Commit 1

```
feat(auth): add authentication schema (User, Session, etc.)

Adds authentication tables: User (email + passwordHash +
emailVerified), Account/Session (Auth.js Prisma adapter requirement;
Account for future OAuth, Session adapter-required even with JWT),
VerificationCode (6-digit codes, hashed), PasswordResetToken
(32-byte hex).

Existing Favorite and DislikedTrack rows attached to a placeholder
admin account (email: daebatzaebis@gmail.com). When user registers
with that email, account "claims" the data by setting passwordHash
and emailVerified.

Migration: prisma/migrations/<ts>_add_authentication_schema
```

---

## Step 2 — Auth.js v5 base setup

### Install

```bash
cd web
pnpm add next-auth@beta @auth/prisma-adapter bcryptjs
pnpm add -D @types/bcryptjs
```

### `web/lib/auth.ts`

```typescript
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 14 * 24 * 60 * 60, // 14 days, sliding via auth() calls
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.passwordHash) return null;
        if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!isValid) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
```

### `web/app/api/auth/[...nextauth]/route.ts`

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

### `web/lib/auth-utils.ts`

```typescript
import { auth } from "@/lib/auth";

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
```

### `web/types/next-auth.d.ts`

```typescript
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
  interface User {
    id: string;
    email?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
```

### Env vars

`web/.env`:
```
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=http://localhost:3000
```

`web/.env.example`:
```
AUTH_SECRET=
AUTH_URL=http://localhost:3000
```

### Verify

```bash
pnpm dev
# http://localhost:3000/api/auth/session → {} (empty, no error)
# http://localhost:3000/api/auth/csrf → { csrfToken: "..." }
```

### Commit 2

```
feat(auth): set up Auth.js v5 with JWT sessions

Configures Auth.js v5 (next-auth@beta) for credentials authentication
with JWT sessions sliding 14 days. Sliding renewal works automatically
through auth() calls — no custom rotation logic needed.

Adds:
- web/lib/auth.ts: central Auth.js config (Credentials provider with
  bcrypt password verification, throws EMAIL_NOT_VERIFIED if user
  hasn't verified)
- web/lib/auth-utils.ts: getCurrentUser() and requireUser() helpers
- web/types/next-auth.d.ts: extends Session.user.id type
- web/app/api/auth/[...nextauth]/route.ts: GET/POST handlers
- AUTH_SECRET, AUTH_URL env vars

Sessions are JWT, not database — Account and Session tables exist
for adapter compatibility but aren't actively used for sessions.
```

---

## Step 3 — Resend integration

### Env

```
RESEND_API_KEY=re_xxxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev
```

`EMAIL_FROM` swaps to user's domain later — no code changes.

```bash
pnpm add resend
```

### `web/lib/email.ts`

```typescript
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

export async function sendVerificationCode(email: string, code: string) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Your Track Digger verification code",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Verify your email</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px;">
          ${code}
        </p>
        <p style="color: #666; font-size: 14px;">This code expires in 15 minutes.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${process.env.AUTH_URL}/reset-password?token=${token}`;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Reset your Track Digger password",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2>Password reset request</h2>
        <p>Click the link to reset your password:</p>
        <p style="margin: 20px 0;">
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
            Reset password
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}
```

### `web/lib/auth-tokens.ts`

```typescript
import crypto from "crypto";
import bcrypt from "bcryptjs";

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
```

### Commit 3

```
feat(auth): Resend integration for transactional emails

Adds:
- web/lib/email.ts: sendVerificationCode and sendPasswordResetEmail
  using Resend SDK directly (NOT Auth.js Resend provider — that
  only supports magic links; we use 6-digit codes)
- web/lib/auth-tokens.ts: code generation, hashing, reset token gen
- RESEND_API_KEY and EMAIL_FROM env vars

EMAIL_FROM defaults to onboarding@resend.dev for development. Swap
to a custom domain later — no code changes.
```

---

## Step 4 — Registration flow + 🛑 USER CHECK-IN POINT 1

This is a major user-facing feature. After implementation, **STOP**
and ask the user to manually test before continuing.

### `web/app/actions/register.ts`

```typescript
"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode, hashCode } from "@/lib/auth-tokens";
import { sendVerificationCode } from "@/lib/email";

const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

export async function registerAction(formData: FormData) {
  const parsed = RegisterSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Invalid email or password format" };
  }

  const { email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && existing.passwordHash) {
    return { error: "Email already registered" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = generateVerificationCode();
  const codeHash = await hashCode(code);
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  if (existing) {
    // Pre-existing admin row — claim it by setting password
    await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });
  } else {
    await prisma.user.create({
      data: { email, passwordHash, emailVerified: null },
    });
  }

  await prisma.verificationCode.deleteMany({ where: { email } });
  await prisma.verificationCode.create({
    data: { email, code: codeHash, expires },
  });

  await sendVerificationCode(email, code);

  return { success: true, email };
}
```

### `web/app/register/page.tsx`

```typescript
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Create account</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Sign up to save favorites and track dislikes
          </p>
        </div>
        <RegisterForm />
      </div>
    </main>
  );
}
```

### `web/components/auth/RegisterForm.tsx`

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registerAction } from "@/app/actions/register";

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await registerAction(formData);
    setPending(false);

    if (result.error) {
      setError(result.error);
    } else if (result.success) {
      router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1" htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required autoComplete="email"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm mb-1" htmlFor="password">Password</label>
        <input type="password" id="password" name="password" required minLength={8} autoComplete="new-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
        <p className="text-xs text-zinc-500 mt-1">At least 8 characters</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
        {pending ? "Creating account..." : "Create account"}
      </button>
      <p className="text-xs text-center text-zinc-500">
        Already have an account?{" "}
        <a href="/login" className="text-blue-400 hover:underline">Sign in</a>
      </p>
    </form>
  );
}
```

### Tests

`web/app/actions/register.test.ts`:
- Valid registration creates user + verification code
- Duplicate email rejects
- Invalid format rejects
- Email send mocked

### 🛑 STOP HERE

After Commit 4 push, send to user:

> "Registration flow implemented. Manual test before continuing:
>
> 1. `cd web && pnpm dev`
> 2. Visit http://localhost:3000/register
> 3. Create account with daebatzaebis@gmail.com (admin email)
> 4. Confirm:
>    - Form submits successfully
>    - Email arrives with 6-digit code
>    - Redirected to /verify-email (will 404 — that's the next step)
>    - DB: code hashed (bcrypt-shaped, not 6 digits):
>      `psql $DATABASE_URL -c 'SELECT email, code, expires FROM \"VerificationCode\";'`
>    - DB: user passwordHash set, emailVerified still null:
>      `psql $DATABASE_URL -c 'SELECT email, \"emailVerified\", LEFT(\"passwordHash\", 30) FROM \"User\";'`
>
> Reply with confirmation. Don't continue if anything is off."

### Commit 4

```
feat(auth): registration flow with email verification

Adds:
- web/app/actions/register.ts: Server Action validates with Zod,
  creates user (or claims pre-existing admin row), generates and
  hashes 6-digit code, sends email
- web/app/register/page.tsx + RegisterForm
- Tests for happy path and validation

Flow:
1. User submits email + password
2. Validate (8-128 char password, valid email)
3. If user exists with passwordHash: reject "already registered"
4. If user exists without passwordHash (admin): claim by setting
   passwordHash
5. Otherwise: create new user
6. Generate code, bcrypt-hash, store with 15-min expiry
7. Send code via Resend
8. Redirect to /verify-email?email=...

Codes hashed before storage so DB compromise doesn't leak in-flight
verification codes.
```

---

## Step 5 — Email verification flow

### `web/app/actions/verify-email.ts`

```typescript
"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyCode, generateVerificationCode, hashCode } from "@/lib/auth-tokens";
import { sendVerificationCode } from "@/lib/email";

const VerifySchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function verifyEmailAction(formData: FormData) {
  const parsed = VerifySchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });

  if (!parsed.success) return { error: "Invalid email or code format" };

  const { email, code } = parsed.data;
  const pendingCodes = await prisma.verificationCode.findMany({
    where: { email, expires: { gt: new Date() } },
  });

  if (pendingCodes.length === 0) {
    return { error: "Code expired or not found. Please request a new one." };
  }

  let matched = false;
  for (const pending of pendingCodes) {
    if (await verifyCode(code, pending.code)) {
      matched = true;
      break;
    }
  }

  if (!matched) return { error: "Invalid code" };

  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });
  await prisma.verificationCode.deleteMany({ where: { email } });

  return { success: true };
}

const ResendSchema = z.object({ email: z.string().email().toLowerCase() });

export async function resendVerificationCodeAction(formData: FormData) {
  const parsed = ResendSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Invalid email" };

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Don't reveal nonexistent users
  if (!user) return { success: true };
  if (user.emailVerified) return { error: "Email already verified" };

  const recent = await prisma.verificationCode.findFirst({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent) {
    return { error: "Please wait a minute before requesting another code" };
  }

  const code = generateVerificationCode();
  const codeHash = await hashCode(code);

  await prisma.verificationCode.deleteMany({ where: { email } });
  await prisma.verificationCode.create({
    data: { email, code: codeHash, expires: new Date(Date.now() + 15 * 60 * 1000) },
  });

  await sendVerificationCode(email, code);
  return { success: true };
}
```

### `web/app/verify-email/page.tsx`

```typescript
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: { email?: string };
}) {
  const email = searchParams.email ?? "";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Verify your email</h1>
          <p className="text-sm text-zinc-400 mt-2">
            We sent a 6-digit code to {email}
          </p>
        </div>
        <VerifyEmailForm email={email} />
      </div>
    </main>
  );
}
```

### `web/components/auth/VerifyEmailForm.tsx`

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyEmailAction, resendVerificationCodeAction } from "@/app/actions/verify-email";

export function VerifyEmailForm({ email }: { email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    formData.set("email", email);
    const result = await verifyEmailAction(formData);
    setPending(false);

    if (result.error) setError(result.error);
    else if (result.success) router.push("/login?verified=true");
  }

  async function handleResend() {
    setResendMsg(null); setError(null);
    const fd = new FormData();
    fd.set("email", email);
    const result = await resendVerificationCodeAction(fd);
    if (result.error) setError(result.error);
    else setResendMsg("New code sent");
  }

  return (
    <>
      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1" htmlFor="code">Verification code</label>
          <input type="text" id="code" name="code" inputMode="numeric"
            pattern="\d{6}" maxLength={6} required autoComplete="one-time-code"
            className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-center text-lg tracking-widest"
            placeholder="123456" />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {resendMsg && <p className="text-sm text-green-400">{resendMsg}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
          {pending ? "Verifying..." : "Verify email"}
        </button>
      </form>
      <button type="button" onClick={handleResend}
        className="w-full text-sm text-zinc-400 hover:text-zinc-300">
        Didn't receive code? Resend
      </button>
    </>
  );
}
```

### Tests

- Valid code marks user verified
- Invalid code rejects
- Expired code rejects
- Resend respects 1-min rate limit
- Resend on already-verified rejects

### Commit 5

```
feat(auth): email verification flow with 6-digit codes

Adds:
- web/app/actions/verify-email.ts: verifyEmailAction +
  resendVerificationCodeAction
- web/app/verify-email/page.tsx + VerifyEmailForm
- Tests for verification + resend rate limiting

Flow:
1. User enters 6-digit code from email
2. Action checks all pending codes (handles resend race)
3. Compares with bcrypt to find match
4. Marks emailVerified, deletes consumed codes
5. Redirects to /login?verified=true

Resend rate limited to 1/min. Error messages don't reveal whether
user exists.
```

---

## Step 6 — Login flow + 🛑 USER CHECK-IN POINT 2

After Step 6, full register → verify → login loop works.

### `web/app/login/page.tsx`

```typescript
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage({
  searchParams,
}: { searchParams: { verified?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </div>
        {searchParams.verified === "true" && (
          <p className="text-sm text-center text-green-400">
            Email verified! Sign in to continue.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
```

### `web/components/auth/LoginForm.tsx`

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true); setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirect: false,
    });
    setPending(false);

    if (result?.error) {
      setError("Invalid email or password, or email not verified");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1" htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required autoComplete="email"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="block text-sm mb-1" htmlFor="password">Password</label>
        <input type="password" id="password" name="password" required autoComplete="current-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <div className="flex justify-between text-xs">
        <a href="/forgot-password" className="text-zinc-400 hover:text-zinc-300">Forgot password?</a>
        <a href="/register" className="text-blue-400 hover:underline">Create account</a>
      </div>
    </form>
  );
}
```

### 🛑 STOP HERE

After Commit 6 push, send to user:

> "Full register + verify + login loop is now working. Manual test:
>
> 1. `pnpm dev`
> 2. /register → use daebatzaebis@gmail.com
> 3. Get code from email, enter at /verify-email
> 4. Redirected to /login?verified=true
> 5. Sign in
> 6. Redirected to home
> 7. `curl http://localhost:3000/api/auth/session` → should return user object
> 8. DevTools → Application → Cookies — `authjs.session-token` should expire in 14 days
>
> Reply with confirmation. Don't continue until auth loop works end-to-end."

### Commit 6

```
feat(auth): login flow with NextAuth signIn

Adds:
- web/app/login/page.tsx
- web/components/auth/LoginForm.tsx (next-auth/react signIn())

Flow:
1. signIn("credentials", { email, password, redirect: false })
2. authorize() in lib/auth.ts: bcrypt verify, check emailVerified
3. JWT issued, set as httpOnly cookie, 14-day sliding expiry
4. router.refresh() so server components see new session

Generic error message for failed logins (don't reveal if user
exists or just unverified).
```

---

## Step 7 — Password reset flow

### `web/app/actions/password-reset.ts`

```typescript
"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { generateResetToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";

const ForgotSchema = z.object({ email: z.string().email().toLowerCase() });

export async function forgotPasswordAction(formData: FormData) {
  const parsed = ForgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Invalid email" };

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Always succeed — don't reveal user existence
  if (!user || !user.passwordHash) return { success: true };

  // Rate limit: 1 reset request per minute
  const recent = await prisma.passwordResetToken.findFirst({
    where: { email, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
  });
  if (recent) return { success: true };  // silently succeed

  const token = generateResetToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h

  await prisma.passwordResetToken.deleteMany({ where: { email } });
  await prisma.passwordResetToken.create({ data: { email, token, expires } });
  await sendPasswordResetEmail(email, token);

  return { success: true };
}

const ResetSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128),
});

export async function resetPasswordAction(formData: FormData) {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Invalid token or password" };

  const { token, password } = parsed.data;
  const reset = await prisma.passwordResetToken.findUnique({ where: { token } });

  if (!reset || reset.expires < new Date()) {
    return { error: "Reset link invalid or expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { email: reset.email },
    data: { passwordHash },
  });
  await prisma.passwordResetToken.deleteMany({ where: { email: reset.email } });

  return { success: true };
}
```

### Pages + forms

`web/app/forgot-password/page.tsx`:

```typescript
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Reset password</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Enter your email and we'll send a reset link
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
```

`web/components/auth/ForgotPasswordForm.tsx`:

```typescript
"use client";
import { useState } from "react";
import { forgotPasswordAction } from "@/app/actions/password-reset";

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    await forgotPasswordAction(formData);
    setPending(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="text-center text-sm text-zinc-400">
        If an account exists for that email, we've sent a reset link.
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1" htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required autoComplete="email"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
```

`web/app/reset-password/page.tsx`:

```typescript
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export default function ResetPasswordPage({
  searchParams,
}: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-red-400">Missing reset token</p>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">New password</h1>
        </div>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
```

`web/components/auth/ResetPasswordForm.tsx`:

```typescript
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordAction } from "@/app/actions/password-reset";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setPending(true); setError(null);
    formData.set("token", token);
    const result = await resetPasswordAction(formData);
    setPending(false);
    if (result.error) setError(result.error);
    else if (result.success) router.push("/login?verified=true");
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1" htmlFor="password">New password</label>
        <input type="password" id="password" name="password" required minLength={8} autoComplete="new-password"
          className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
        <p className="text-xs text-zinc-500 mt-1">At least 8 characters</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium disabled:opacity-50">
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
```

### Tests

- Forgot password creates token + sends email
- Forgot password for unknown email returns success (no enum)
- Reset with valid token updates passwordHash
- Reset with expired token rejects
- Old tokens deleted after success

### Commit 7

```
feat(auth): password reset flow via email

Adds:
- web/app/actions/password-reset.ts: forgotPasswordAction +
  resetPasswordAction
- web/app/forgot-password/page.tsx + ForgotPasswordForm
- web/app/reset-password/page.tsx + ResetPasswordForm
- Tests

Flow:
1. /forgot-password — submit email
2. If user has password, generate 32-byte hex token (1h expiry),
   email link, return success regardless
3. /reset-password?token=... — submit new password
4. Action validates token, updates passwordHash, deletes all reset
   tokens for the email
5. Redirect to /login

Always reports success on forgot-password to prevent enumeration.
Rate-limited to 1/min internally.
```

---

## Step 8 — Per-user Favorites/DislikedTrack + 🛑 USER CHECK-IN POINT 3

Update existing favorites/dislikes API routes to require auth and
scope to current user.

### `web/app/api/favorites/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      select: { trackId: true },
    });
    return NextResponse.json(favorites);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { trackId } = await req.json();
    if (!trackId) {
      return NextResponse.json({ error: "trackId required" }, { status: 400 });
    }
    await prisma.favorite.upsert({
      where: { userId_trackId: { userId: user.id, trackId } },
      create: { userId: user.id, trackId },
      update: {},
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const { trackId } = await req.json();
    if (!trackId) {
      return NextResponse.json({ error: "trackId required" }, { status: 400 });
    }
    await prisma.favorite.deleteMany({
      where: { userId: user.id, trackId },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

### `web/app/api/dislikes/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await prisma.dislikedTrack.findMany({
      where: { userId: user.id },
      select: { artistKey: true, titleKey: true, artist: true, title: true },
    });
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { artist, title } = await req.json();
    if (!artist || !title) {
      return NextResponse.json({ error: "artist and title required" }, { status: 400 });
    }
    const artistKey = normalizeArtist(artist);
    const titleKey = normalizeTitle(title);
    await prisma.dislikedTrack.upsert({
      where: { userId_artistKey_titleKey: { userId: user.id, artistKey, titleKey } },
      create: { userId: user.id, artistKey, titleKey, artist, title },
      update: {},
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const { artist, title } = await req.json();
    if (!artist || !title) {
      return NextResponse.json({ error: "artist and title required" }, { status: 400 });
    }
    const artistKey = normalizeArtist(artist);
    const titleKey = normalizeTitle(title);
    await prisma.dislikedTrack.deleteMany({
      where: { userId: user.id, artistKey, titleKey },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
```

### Update `/api/search` dislike filter

Currently loads ALL DislikedTrack rows. Scope to current user:

```typescript
import { auth } from "@/lib/auth";

// In runSearch, before fusion:
const session = await auth();
const userId = session?.user?.id;

const dislikes = userId
  ? await prisma.dislikedTrack.findMany({
      where: { userId },
      select: { artistKey: true, titleKey: true },
    })
  : [];

const dislikedKeys = new Set(
  dislikes.map((d) => `${d.artistKey}|${d.titleKey}`)
);
```

Anonymous users get no dislike filter (their results are unfiltered).

### UI changes

`web/app/page.tsx`:

```typescript
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();
  const isAuthenticated = !!session?.user;
  // Pass isAuthenticated to TrackCard via props
}
```

`TrackCard.tsx` — hide favorite/dislike buttons if not authenticated:

```typescript
{isAuthenticated && (
  <>
    <button onClick={onFavorite}>♥</button>
    <button onClick={onDislike}>✕</button>
  </>
)}
```

(The proper register prompt with anonymous limit is Stage J.)

### 🛑 STOP HERE

After Commit 8 push, send to user:

> "Per-user favorites/dislikes implemented. Manual test:
>
> 1. Sign in (your account from Step 6)
> 2. Make a search
> 3. Favorite + dislike a few tracks
> 4. DB check:
>    `psql $DATABASE_URL -c 'SELECT \"userId\", COUNT(*) FROM \"Favorite\" GROUP BY \"userId\";'`
>    Should show your userId. Original 9 favorites are on
>    admin_seed_account_id which is the same row your account
>    claimed — they're already yours.
> 5. Sign out — favorite/dislike buttons should disappear
> 6. Sign back in — favorites/dislikes persist
>
> Reply with confirmation."

### Commit 8

```
feat(auth): per-user favorites and disliked tracks

Updates:
- /api/favorites GET/POST/DELETE: scoped to authenticated user, 401
  if not signed in
- /api/dislikes GET/POST/DELETE: scoped to authenticated user
- /api/search dislike filter: uses authenticated user's dislikes
  (empty set for anonymous)
- TrackCard: favorite/dislike buttons hidden if not authenticated
- Home page passes isAuthenticated to TrackCard

Anonymous users see search results without dislike filtering and
without favorite/dislike actions. Anonymous request limits and the
register prompt come in Stage J.
```

---

## Step 9 — Auth-required nav + UI polish

### Update header/nav

Find existing header (probably in `web/app/layout.tsx` or a header
component). Add:

```typescript
import { auth, signOut } from "@/lib/auth";

const session = await auth();

return (
  <nav className="...">
    {session?.user ? (
      <>
        <span className="text-sm text-zinc-400">{session.user.email}</span>
        <form action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}>
          <button type="submit" className="text-sm hover:text-zinc-200">Sign out</button>
        </form>
      </>
    ) : (
      <a href="/login" className="text-sm hover:text-zinc-200">Sign in</a>
    )}
  </nav>
);
```

### Commit 9

```
feat(auth): navigation auth state and signOut

Header now shows authenticated user's email + sign-out button, or
Sign In link for anonymous. signOut runs as Server Action with
explicit redirectTo home.

This completes the auth UI surface for Stage I. Stage J handles
anonymous request limits and the register prompt modal.
```

---

## Step 10 — Tests + ADR-0020 + docs

### Run all tests

```bash
cd web && pnpm test && pnpm build
cd python-service && .venv/bin/pytest
```

If any test fails, fix before continuing. Don't ship broken tests.

### ADR-0020

`web/docs/decisions/0020-authentication-stage-i.md`:

```markdown
# 0020 — Authentication (Auth.js v5, Stage I)

## Status
Accepted (2026-XX-XX)

## Context
Project moving toward public launch. Anonymous access is fine for
search, but favorites/dislikes need per-user scoping. Authentication
is required.

## Decision
- Auth.js v5 (next-auth@beta) with Credentials provider
- JWT sessions, 14-day sliding expiry (auto-rotates via auth())
- Email + password + 6-digit code email verification
- Password reset via email link
- Resend for transactional emails
- Email-only identifier (no usernames)
- No OAuth in Stage I (user declined Google + Apple)

## Consequences
- 5 new tables: User, Account, Session, VerificationCode,
  PasswordResetToken (Account/Session required by adapter even with
  JWT sessions)
- Favorite + DislikedTrack gain userId, unique constraints updated
- Migration option A: 9 favorites + 30 dislikes attached to admin
  pre-create row (email: daebatzaebis@gmail.com); user claims by
  registering with that email
- Sliding renewal works automatically — no custom rotation logic
- Email enumeration prevented in forgot-password and verify-resend
  by always returning success

## Alternatives
- Custom session implementation (Lucia migration guide pattern):
  rejected, more code to maintain, no clear advantage
- Database sessions: rejected, Auth.js v5 Credentials only
  officially supports JWT
- Magic link verification (no password): rejected by user, chose
  6-digit code for mobile-friendly UX
- OAuth (Google/Apple): rejected by user for Stage I; potential
  Stage K work

## Future
- Stage J: anonymous request limits + Cloudflare Turnstile CAPTCHA
- Stage K: production hardening — caching, rate limiting, OAuth (?)
- Stage L: deploy
```

### Update CLAUDE.md and README

Add Authentication sections describing:
- Auth.js v5 setup
- Server Actions for register/verify/forgot/reset
- requireUser() helper for protected routes
- Migration A claim pattern
- /register, /login, /verify-email, /forgot-password, /reset-password routes

### Commit 10

```
docs: ADR-0020 + Stage I documentation

- ADR-0020 documents Auth.js v5 setup, JWT sliding sessions,
  6-digit code verification, and the migration A claim pattern
- CLAUDE.md adds Authentication section with patterns and helpers
- README documents auth routes

Stage I complete. Auth working end-to-end:
- Register with email + password
- Verify with 6-digit code via email
- Sign in with sliding 14-day session
- Reset password via email link
- Per-user favorites and disliked tracks

Stage J: anonymous request limits + CAPTCHA.
```

---

## At the end of the stage

When all 10 commits are done:

1. Final test run:
   ```bash
   cd web && pnpm test && pnpm build
   cd python-service && .venv/bin/pytest
   ```

2. Final report covering:
   - `git log --oneline -12`
   - Per-commit summary
   - Manual end-to-end walk-through (register → verify → login →
     favorite a track → logout → verify favorites hidden → reset
     password → log in again → favorites still there)
   - Migration verification (admin email claim worked, 9+30 rows
     attached to user)
   - Any business questions that came up
   - Any deviations from spec

3. Push origin/main when complete.

---

## What this stage does NOT do

- OAuth providers (Google, Apple) — user declined
- Anonymous request counter or limits (Stage J)
- CAPTCHA on register (Stage J)
- Production rate limiting (Stage K)
- Per-user search rate limiting (Stage K)
- Account deletion (GDPR consideration for later)
- 2FA
- "Sign out from all devices" (requires database sessions, not JWT)
- Login history / active sessions list

## Pitfalls

- **Auth.js v5 is in beta**. APIs may shift. If something doesn't
  match docs at https://authjs.dev, check GitHub discussions for
  v5-specific notes.

- **bcrypt vs argon2**. We use bcryptjs (pure JS, simpler install).
  argon2 stronger but requires native bindings that fail on some
  platforms. bcrypt fine for launch.

- **Email enumeration**. Forgot password + verification resend must
  NEVER reveal whether a user exists. Always return generic success.

- **VerificationCode race**. If user requests two codes in quick
  succession, both stored. Verification logic must check ALL
  pending codes for the email, not just the latest.

- **JWT sliding renewal is automatic**. Just calling `auth()`
  extends the cookie. Don't add custom rotation logic in callbacks
  — that's how it silently breaks. Trust the default.

- **Migration order**. User table must exist before adding userId
  to Favorite/DislikedTrack. Admin row must be inserted before the
  UPDATE statements that backfill userId. Test on dev DB copy if
  uncertain.

- **`@@unique` constraint changes** require dropping old constraint
  before creating new. Auto-generated migration may not handle this
  correctly — write SQL by hand if needed.

- **`router.refresh()` after login**. Without `refresh()`, the
  server component nav won't see the new session. Always call
  `router.refresh()` after signIn().

- **Zod normalization**. Email lowercase in every action. Otherwise
  "User@Example.com" and "user@example.com" are different rows.

## Open questions to ask user mid-stage

If you encounter ambiguity beyond the decisions already made:

1. After verification, auto-sign-in or redirect to login? Spec:
   redirect (more standard). Default: redirect.

2. Failed login lockout after N attempts? Spec: no lockout. Rate
   limiting at API gateway (Stage K) handles this without
   user-visible lockout.

3. Account deletion: not in Stage I. Defer to Stage K (GDPR
   requirement before EU launch).

Don't ask "should we do X" for things this spec already decided.
Only ask for genuinely new ambiguity.
