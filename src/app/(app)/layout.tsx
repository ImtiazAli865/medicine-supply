import { redirect } from "next/navigation";
import { OfflineProvider } from "@/components/offline/OfflineProvider";
import { AppShell } from "@/components/shell/AppShell";
import { loadBusinessContext } from "@/lib/api/auth";

// Every screen here depends on the signed-in user, so nothing is prerendered at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Defense in depth: the proxy already redirects, but protection never relies on it alone.
  const result = await loadBusinessContext();
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "no_business") redirect("/account-not-set-up");

  const { supabase, businessId, user } = result.context;
  const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();

  const businessName = business?.name ?? "My business";

  // The offline provider needs the server-verified user and business so the phone can find its own data later, offline.
  return (
    <OfflineProvider server={{ userId: user.id, businessId, businessName }}>
      <AppShell businessName={businessName}>{children}</AppShell>
    </OfflineProvider>
  );
}
