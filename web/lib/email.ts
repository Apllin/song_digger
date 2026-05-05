import { Resend } from "resend";

// Lazy singleton. Constructing `new Resend(undefined)` throws — we
// don't want module load to crash during `next build` when the key
// isn't injected into the build environment (Railway, Vercel preview
// without secret, etc.). Resolve the key on first send instead, so
// the build collects page data without a real Resend account.
let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error(
        "RESEND_API_KEY is not set — email sending is disabled in this environment",
      );
    }
    resendInstance = new Resend(key);
  }
  return resendInstance;
}

// Resend SDK returns `{ data, error }` instead of throwing. Discarding
// the result silently swallows API errors (invalid key, free-tier
// sandbox limits, unverified `from` domain). Throw so callers can
// surface a real failure instead of a phantom success.
async function send(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { error } = await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    throw new Error(
      `Resend send failed (${error.name ?? "unknown"}): ${error.message}`,
    );
  }
}

export async function sendVerificationCode(
  email: string,
  code: string,
): Promise<void> {
  await send({
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

export async function sendLoginAttemptsWarning(
  email: string,
  ip: string,
): Promise<void> {
  const resetUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/forgot-password`;
  await send({
    to: email,
    subject: "Multiple failed login attempts on your Track Digger account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Security alert</h2>
        <p>We detected 5 or more failed sign-in attempts on your account
        in the past hour.</p>
        <p>If this was you and you forgot your password, use the
        <a href="${resetUrl}">password reset flow</a>.</p>
        <p>If this wasn&rsquo;t you, your account is still safe &mdash; the
        attacker couldn&rsquo;t get in. Consider changing your password
        as a precaution.</p>
        <p style="color: #666; font-size: 12px;">Attempt source IP: ${ip}</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<void> {
  const resetUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await send({
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
