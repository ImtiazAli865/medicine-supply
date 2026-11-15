import { Suspense } from "react";
import { InvoicesScreen } from "@/components/invoices/InvoicesScreen";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Invoices · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading invoices…" />}>
      <InvoicesScreen />
    </Suspense>
  );
}
