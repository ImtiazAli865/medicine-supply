import { Suspense } from "react";
import { AccountsScreen } from "@/components/accounts/AccountsScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Store accounts · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading store accounts…" />}>
      <AccountsScreen />
    </Suspense>
  );
}
