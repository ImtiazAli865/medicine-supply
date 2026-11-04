import { redirect } from "next/navigation";
import { UserX } from "lucide-react";
import { SignOutButton } from "@/components/shell/SignOutButton";
import { loadBusinessContext } from "@/lib/api/auth";

export const metadata = { title: "Account not set up · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function AccountNotSetUpPage() {
  const result = await loadBusinessContext();
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "ok") redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <UserX size={40} className="text-warning" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Your account is not set up yet</h1>
      <p className="text-muted">
        You are signed in, but no business is linked to this account, so no data can be shown. Ask the owner to finish
        setting up your account.
      </p>
      <SignOutButton />
    </main>
  );
}
