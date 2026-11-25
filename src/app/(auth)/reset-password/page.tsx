import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { FORGOT_LINK_ERROR_PATH, MIN_PASSWORD } from "@/lib/auth/reset";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a new password · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  // This page needs the session that the emailed link creates (see /auth/confirm). Without one, the way back is a new link.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(FORGOT_LINK_ERROR_PATH);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <KeyRound size={40} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="text-muted">Use at least {MIN_PASSWORD} characters. You do not need your old password.</p>
      </div>
      <ResetPasswordForm />
    </main>
  );
}
