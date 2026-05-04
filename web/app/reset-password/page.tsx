import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

// Next.js 16: searchParams is a Promise.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

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
