import { ClipboardList } from "lucide-react";
import { OrderSheetDayToolbar } from "@/components/invoices/OrderSheetDayToolbar";
import { OrderSheetView } from "@/components/invoices/OrderSheetView";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { requirePageContext } from "@/lib/api/auth";
import { getOrderSheetDay } from "@/lib/invoices/repository";
import { ListQuerySchema } from "@/lib/validation/market";

export const metadata = { title: "Print order sheets · Medicine Supply" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Print option B: the confirmed orders of a day for all or some stores in one document. Every order of every store is
 * its own section with its own complete product list. Quantities and units only, never a price.
 */
export default async function OrderSheetsDayPage({ searchParams }: PageProps<"/orders/print">) {
  const { supabase } = await requirePageContext();
  const raw = await searchParams;
  const parsed = ListQuerySchema().safeParse({ date: first(raw.date), stores: first(raw.stores) });
  const query = parsed.success ? parsed.data : ListQuerySchema().parse({});

  // All the stores that have orders that day (for the store choice), then the sheet for the chosen ones.
  const everything = await getOrderSheetDay(supabase, query.date, []);
  const sheet = query.stores.length > 0 ? await getOrderSheetDay(supabase, query.date, query.stores) : everything;
  const stores = [...new Map(everything.sections.map((s) => [s.store.id, { id: s.store.id, name: s.store.name }])).values()];
  const included = query.stores.length > 0 ? stores.filter((s) => query.stores.includes(s.id)).map((s) => s.name).join(", ") : "All stores";

  return (
    <div className="space-y-4">
      <OrderSheetDayToolbar date={query.date} stores={stores} selected={query.stores} canPrint={sheet.sections.length > 0} />
      {sheet.sections.length > 0 ? (
        <OrderSheetView sheet={sheet} title={`Order sheets · ${query.date} · ${included}`} />
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No confirmed orders"
          description="There are no confirmed orders for this date and these stores. Choose another date, or take or confirm an order."
          action={<ButtonLink href="/orders">Go to orders</ButtonLink>}
        />
      )}
    </div>
  );
}
