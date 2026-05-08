import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy — Track Digger",
};

export default function CookiePolicyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16 text-td-fg">
      <h1
        className="font-display text-[32px] sm:text-[40px] leading-tight mb-6"
        style={{ letterSpacing: "-0.02em", fontWeight: 600 }}
      >
        Cookie Policy
      </h1>

      <p
        className="text-[15px] leading-relaxed mb-8"
        style={{ color: "var(--td-fg-d)" }}
      >
        This policy explains how Track Digger (&ldquo;the Service&rdquo;) uses
        cookies and similar technologies. The Service relies exclusively on
        cookies that are strictly necessary for its operation. No cookies are
        used for analytics, advertising, profiling, or cross-site tracking.
      </p>

      <h2
        className="font-display text-[22px] mb-4"
        style={{ letterSpacing: "-0.01em", fontWeight: 600 }}
      >
        Cookies in use
      </h2>

      <ul
        className="space-y-4 mb-8 text-[14.5px] leading-relaxed"
        style={{ color: "var(--td-fg-d)" }}
      >
        <li>
          <span className="font-mono-td text-td-fg">authjs.session-token</span>{" "}
          — authentication session issued upon sign-in. Stored as a signed JWT
          and renewed on activity, with a maximum lifetime of fourteen days.
        </li>
        <li>
          <span className="font-mono-td text-td-fg">authjs.csrf-token</span>,{" "}
          <span className="font-mono-td text-td-fg">authjs.callback-url</span>{" "}
          — required by the authentication framework (Auth.js) to protect
          sign-in and registration forms against cross-site request forgery.
        </li>
        <li>
          <span className="font-mono-td text-td-fg">cf_*</span> — set by
          Cloudflare Turnstile during human verification on sign-in and
          registration. Governed by Cloudflare&rsquo;s privacy terms.
        </li>
        <li>
          <span className="font-mono-td text-td-fg">td_cookie_consent</span> —
          records that this notice has been acknowledged. Retained for one
          year.
        </li>
      </ul>

      <h2
        className="font-display text-[22px] mb-4"
        style={{ letterSpacing: "-0.01em", fontWeight: 600 }}
      >
        Legal basis
      </h2>

      <p
        className="text-[15px] leading-relaxed mb-8"
        style={{ color: "var(--td-fg-d)" }}
      >
        Because the cookies above are strictly necessary for the delivery of a
        service explicitly requested by the user, they are exempt from the
        consent requirement under Article 5(3) of Directive 2002/58/EC (the
        ePrivacy Directive) and corresponding national implementations. The
        notice is provided for transparency.
      </p>

      <h2
        className="font-display text-[22px] mb-4"
        style={{ letterSpacing: "-0.01em", fontWeight: 600 }}
      >
        Managing cookies
      </h2>

      <p
        className="text-[15px] leading-relaxed mb-4"
        style={{ color: "var(--td-fg-d)" }}
      >
        As no optional cookies are set, the Service does not provide an
        opt-out mechanism. Users may delete cookies through their browser
        settings at any time; doing so will end the active session and may
        require re-verification on the next visit. The Service can also be
        used anonymously, subject to the request limits applicable to
        unauthenticated users.
      </p>

      <h2
        className="font-display text-[22px] mb-4"
        style={{ letterSpacing: "-0.01em", fontWeight: 600 }}
      >
        Changes to this policy
      </h2>

      <p
        className="text-[15px] leading-relaxed mb-4"
        style={{ color: "var(--td-fg-d)" }}
      >
        This policy may be updated to reflect changes in the cookies used or
        in applicable law. Material changes will be communicated through the
        notice displayed on the Service.
      </p>

      <p
        className="text-[13px] mt-10 pt-6"
        style={{
          color: "var(--td-fg-m)",
          borderTop: "1px solid var(--td-hair)",
        }}
      >
        For questions regarding this policy, please contact the Service
        operator.
      </p>
    </main>
  );
}
