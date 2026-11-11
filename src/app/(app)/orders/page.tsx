import { Suspense } from "react";
import { OrderHistory } from "@/components/orders/OrderHistory";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Orders · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  await requirePageContext();
  return (
    <Suspense fallback={<LoadingBlock label="Loading orders…" />}>
      <OrderHistory />
    </Suspense>
  );
}
