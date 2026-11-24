import { Suspense } from "react";
import { MedicinesReportScreen } from "@/components/reports/MedicinesReportScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Sales by medicine · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function MedicinesReportPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading the report…" />}>
      <MedicinesReportScreen />
    </Suspense>
  );
}
