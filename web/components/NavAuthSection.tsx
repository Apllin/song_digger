import Link from "next/link";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { auth } from "@/lib/auth";

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
      <SignOutButton email={session.user.email ?? undefined} />
    </div>
  );
}
