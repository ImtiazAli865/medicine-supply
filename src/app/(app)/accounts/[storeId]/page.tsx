import { notFound } from "next/navigation";
import { AccountScreen } from "@/components/accounts/AccountScreen";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Store account · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: PageProps<"/accounts/[storeId]">) {
  const { storeId } = await params;
  await requirePageContext();
  if (!isUuid(storeId)) notFound();
  return <AccountScreen storeId={storeId} />;
}
