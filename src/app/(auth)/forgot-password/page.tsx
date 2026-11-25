import { KeyRound } from "lucide-react";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Banner } from "@/components/ui/States";
import { LINK_ERROR_MESSAGE } from "@/lib/auth/reset";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Forgot password · Medicine Supply" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const linkProblem = params.error === "link";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <KeyRound size={40} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        <p className="text-muted">Enter the email you sign in with. If it has an account, we send a link to choose a new password.</p>
      </div>
      {linkProblem ? (
        <div data-testid="reset-link-problem">
          <Banner kind="warning">{LINK_ERROR_MESSAGE}</Banner>
        </div>
      ) : null}
      {isSupabaseConfigured() ? (
        <ForgotPasswordForm />
      ) : (
        <Banner kind="error">The app is not connected to a database yet, so a password cannot be reset.</Banner>
      )}
      <p className="text-center">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center px-2 font-medium text-primary underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
