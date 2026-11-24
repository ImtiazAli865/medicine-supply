import { Suspense } from "react";
import { StoresReportScreen } from "@/components/reports/StoresReportScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Sales by store · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function StoresReportPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <StoresReportScreen />
    </Suspense>
  );
}
