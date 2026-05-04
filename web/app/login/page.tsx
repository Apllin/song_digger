import { LoginForm } from "@/components/auth/LoginForm";

// Next.js 16: searchParams is a Promise.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string | string[] }>;
}) {
  const params = await searchParams;
  const justVerified = params.verified === "true";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Sign in</h1>
        </div>
        {justVerified && (
          <p className="text-sm text-center text-green-400">
            Email verified! Sign in to continue.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
