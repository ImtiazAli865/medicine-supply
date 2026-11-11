import { NewOrderStart } from "@/components/orders/NewOrderStart";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "New order · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  await requirePageContext();
  return <NewOrderStart />;
}
