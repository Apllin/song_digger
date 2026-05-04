import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Reset password</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Enter your email and we&apos;ll send a reset link
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
