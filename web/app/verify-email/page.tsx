import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";

// Next.js 16: searchParams is a Promise, page must be async.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Verify your email</h1>
          <p className="text-sm text-zinc-400 mt-2">
            We sent a 6-digit code to {email || "your email"}
          </p>
        </div>
        <VerifyEmailForm email={email} />
      </div>
    </main>
  );
}
