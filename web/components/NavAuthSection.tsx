import Link from "next/link";

import { auth, signOut } from "@/lib/auth";

// Server Component — runs in the request context, calls auth() to read
// the session cookie. The signOut form action is an inline Server Action
// that clears the JWT cookie and redirects home.
export async function NavAuthSection() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Outlined Action Button — Launch Violet border, 60px radius. */}
        <Link
          href="/login"
          className="hidden sm:inline-flex items-center font-bold text-[14px] transition-colors hover:bg-[rgba(112,132,255,0.08)]"
          style={{
            color: "#ffffff",
            border: "1px solid #7084ff",
            borderRadius: "60px",
            padding: "10px 22px",
            background: "transparent",
          }}
        >
          Sign in
        </Link>
        {/* Primary Action Button — purple fill, 30px radius. The lighter
            violet lifts the CTA off the dark bg without overpowering. */}
        <Link
          href="/register"
          className="inline-flex items-center font-bold text-[14px] transition-opacity hover:opacity-90"
          style={{
            color: "#ffffff",
            background: "#4d3ec2",
            border: "1px solid rgba(216, 200, 255, 0.22)",
            borderRadius: "30px",
            padding: "10px 22px",
          }}
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="hidden md:inline text-sm text-zinc-500 truncate max-w-[200px]" title={session.user.email ?? ""}>
        {session.user.email}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="w-9 h-9 flex items-center justify-center rounded-full border transition-opacity hover:opacity-85"
          aria-label="Sign out"
          title={`Sign out${session.user.email ? ` — ${session.user.email}` : ""}`}
          style={{
            background: "rgba(40, 32, 110, 0.82)",
            borderColor: "rgba(216, 200, 255, 0.22)",
            color: "var(--td-fg)",
            backdropFilter: "blur(20px) saturate(140%)",
            WebkitBackdropFilter: "blur(20px) saturate(140%)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
          }}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
