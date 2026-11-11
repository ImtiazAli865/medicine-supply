import { notFound } from "next/navigation";
import { OrderScreen } from "@/components/orders/OrderScreen";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Order · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  await requirePageContext();
  if (!isUuid(id)) notFound();
  const store = typeof query.store === "string" && isUuid(query.store) ? query.store : null;
  return <OrderScreen id={id} storeParam={store} />;
}
