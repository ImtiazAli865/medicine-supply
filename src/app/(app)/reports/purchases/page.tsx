import { Suspense } from "react";
import { PurchasesReportScreen } from "@/components/reports/PurchasesReportScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Purchases · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function PurchasesReportPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <PurchasesReportScreen />
    </Suspense>
  );
}
