import { notFound } from "next/navigation";
import { InvoiceScreen } from "@/components/invoices/InvoiceScreen";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Invoice · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  await requirePageContext();
  if (!isUuid(id)) notFound();
  return <InvoiceScreen id={id} />;
}
