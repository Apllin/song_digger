import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
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
          <h1 className="text-2xl font-semibold">Create account</h1>
          <p className="text-sm text-zinc-400 mt-2">Sign up to save favorites and track dislikes</p>
        </div>
        <RegisterForm />
      </div>
    </main>
  );
}
