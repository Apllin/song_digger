import NextAuth, { CredentialsSignin } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// Subclass so the `code` field reaches the client unchanged. NextAuth
// turns plain `throw new Error(...)` into a generic CredentialsSignin
// with `code: "credentials"`, which collapses our distinct cases.
class RateLimitError extends CredentialsSignin {
  code = "RATE_LIMIT";
}
class CaptchaRequiredError extends CredentialsSignin {
  code = "CAPTCHA_REQUIRED";
}
import { prisma } from "@/lib/prisma";
import { getRequestIp } from "@/lib/anonymous-counter";
import {
  checkIpRateLimit,
  clearFailedAttempts,
  getBackoffDelayMs,
  getEmailFailedCount,
  recordLoginAttempt,
  shouldNotifyOnThisFailure,
  shouldRequireCaptcha,
} from "@/lib/brute-force";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendLoginAttemptsWarning } from "@/lib/email";

// Auth.js v5 (Credentials + JWT). The PrismaAdapter is wired even though
// Credentials never writes through it — it's there so a future OAuth
// provider can persist Account/Session rows without a config change.
// See ADR-0020 + ADR-0021.
export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    // 14-day sliding expiry. Auth.js refreshes the cookie on `auth()`
    // calls automatically; no custom rotation logic needed.
    strategy: "jwt",
    maxAge: 14 * 24 * 60 * 60,
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
        turnstileToken: { label: "Turnstile token", type: "text" },
      },
      // Returns null for every "wrong credentials" path so the login
      // UI can show a single, non-revealing error. Throws a
      // CredentialsSignin (with `code`) only for rate-limit and
      // captcha failures — the UI maps `code` to a clearer message
      // for those, since they don't leak account existence.
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).toLowerCase();
        const password = String(credentials.password);
        const turnstileToken =
          typeof credentials.turnstileToken === "string"
            ? credentials.turnstileToken
            : "";

        const ip = await getRequestIp();

        // IP rate limit: 10 failed attempts / 15min hard stop. Checked
        // before the work so a saturated attacker can't keep grinding
        // backoff timers either. Thrown as a CredentialsSignin so the
        // client can map it to a clear error.
        const { blocked: ipBlocked } = await checkIpRateLimit(ip);
        if (ipBlocked) {
          await recordLoginAttempt(ip, email, false);
          throw new RateLimitError();
        }

        // CAPTCHA gate after 3 failed attempts on this email. Verified
        // before the bcrypt compare so a botnet can't drain CPU on
        // password tries. Skipped only when the server isn't
        // configured for Turnstile.
        const requireCaptcha =
          !!process.env.TURNSTILE_SECRET_KEY &&
          (await shouldRequireCaptcha(email));
        if (requireCaptcha) {
          const captchaOk = await verifyTurnstileToken(turnstileToken, {
            remoteIp: ip === "unknown" ? undefined : ip,
          });
          if (!captchaOk) {
            await recordLoginAttempt(ip, email, false);
            throw new CaptchaRequiredError();
          }
        }

        // Per-email exponential backoff. Sleeps inside authorize so
        // the form-side UX is "submit just takes a while" rather than
        // a separate state machine. Caller (Vercel/etc.) must allow
        // a function timeout > 64s for /api/auth/* — see ADR-0021.
        const failedCountBefore = await getEmailFailedCount(email);
        const backoffMs = getBackoffDelayMs(failedCountBefore);
        if (backoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const passwordOk =
          user?.passwordHash &&
          (await bcrypt.compare(password, user.passwordHash));
        const verified = !!user?.emailVerified;

        if (!user || !passwordOk || !verified) {
          await recordLoginAttempt(ip, email, false);

          // Send the "5+ failed attempts" warning exactly once at the
          // crossing. Only for accounts that exist — nothing leaks
          // about non-existent emails (sender side). Fire-and-forget
          // so a Resend hiccup doesn't slow the response further.
          if (user && shouldNotifyOnThisFailure(failedCountBefore)) {
            sendLoginAttemptsWarning(email, ip).catch((err) =>
              console.error("[auth] security email send failed:", err),
            );
          }
          return null;
        }

        await recordLoginAttempt(ip, email, true);
        await clearFailedAttempts(email);
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
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
