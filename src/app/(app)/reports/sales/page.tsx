import { Suspense } from "react";
import { SalesReportScreen } from "@/components/reports/SalesReportScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Sales and profit · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function SalesReportPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <SalesReportScreen />
    </Suspense>
  );
}
