import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

// Server Component — runs in the request context, calls auth() to read
// the session cookie. The signOut form action is an inline Server Action
// that clears the JWT cookie and redirects home.
export async function NavAuthSection() {
  const session = await auth();

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className="text-sm text-zinc-500 truncate max-w-[200px]"
        title={session.user.email ?? ""}
      >
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
          className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
