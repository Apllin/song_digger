import { LoginForm } from "@/components/auth/LoginForm";

// Next.js 16: searchParams is a Promise.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    verified?: string | string[];
    email?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const justVerified = params.verified === "true";
  const initialEmail = typeof params.email === "string" ? params.email : "";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div
        className="w-full max-w-sm space-y-6 rounded-xl p-6 sm:p-8"
        style={{
          background: "var(--td-bg-2)",
          border: "1px solid var(--td-hair-2)",
        }}
      >
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </div>
        {justVerified && <p className="text-sm text-center text-green-400">Email verified! Sign in to continue.</p>}
        <LoginForm initialEmail={initialEmail} autoFocusPassword={justVerified} />
      </div>
    </main>
  );
}
