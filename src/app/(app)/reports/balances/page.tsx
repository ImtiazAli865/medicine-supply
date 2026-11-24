import { Suspense } from "react";
import { BalancesReportScreen } from "@/components/reports/BalancesReportScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Outstanding balances · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function BalancesReportPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <BalancesReportScreen />
    </Suspense>
  );
}
