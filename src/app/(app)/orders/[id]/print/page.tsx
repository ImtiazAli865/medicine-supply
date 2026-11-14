import { ChevronLeft, FileQuestion } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderSheetView } from "@/components/invoices/OrderSheetView";
import { PrintButton } from "@/components/market/PrintButton";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { getOrderSheet } from "@/lib/invoices/repository";

export const metadata = { title: "Print order sheet · Medicine Supply" };
export const dynamic = "force-dynamic";

/** Print option A: one order as an order sheet (product, quantity and unit, no prices). */
export default async function OrderSheetPage({ params }: PageProps<"/orders/[id]/print">) {
  const { id } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const sheet = await getOrderSheet(supabase, [id]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden" data-testid="sheet-toolbar">
        <Link href={`/orders/${id}`} className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ChevronLeft size={20} aria-hidden="true" /> Order
        </Link>
        {sheet.sections.length > 0 ? <PrintButton /> : null}
      </div>
      {sheet.sections.length > 0 ? (
        <OrderSheetView sheet={sheet} title="Order sheet" />
      ) : (
        <EmptyState
          icon={FileQuestion}
          title="Nothing to print"
          description="Only a confirmed order can be printed as an order sheet. This order is a draft, was cancelled, or does not exist."
          action={<ButtonLink href={`/orders/${id}`}>Back to the order</ButtonLink>}
        />
      )}
    </div>
  );
}
