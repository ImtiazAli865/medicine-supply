import { Suspense } from "react";
import { CostMissingScreen } from "@/components/reports/CostMissingScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Cost missing · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function CostMissingPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <CostMissingScreen />
    </Suspense>
  );
}
