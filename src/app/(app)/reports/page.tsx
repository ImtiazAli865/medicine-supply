import { ReportsHub } from "@/components/reports/ReportsHub";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Reports · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requirePageContext();
  return <ReportsHub />;
}
