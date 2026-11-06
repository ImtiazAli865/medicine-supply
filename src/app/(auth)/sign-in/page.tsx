import { Pill } from "lucide-react";
import { SignInForm } from "@/components/auth/SignInForm";
import { Banner } from "@/components/ui/States";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Sign in · Medicine Supply" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const expired = params.reason === "expired";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <Pill size={40} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Medicine Supply</h1>
        <p className="text-muted">Sign in to manage your stores and medicines.</p>
      </div>
      {isSupabaseConfigured() ? (
        <SignInForm next={next} expired={expired} />
      ) : (
        <Banner kind="error">
          The app is not connected to a database yet. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then restart.
        </Banner>
      )}
    </main>
  );
}
