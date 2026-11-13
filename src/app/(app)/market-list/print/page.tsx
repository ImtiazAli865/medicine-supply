import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { MarketPrintView } from "@/components/market/MarketPrintView";
import { PrintButton } from "@/components/market/PrintButton";
import { Banner } from "@/components/ui/States";
import { ApiError } from "@/lib/api/errors";
import { requirePageContext } from "@/lib/api/auth";
import { marketScreenUrl, type ListParams } from "@/lib/market/client";
import { getCompleteMarketList } from "@/lib/market/repository";
import type { MarketList } from "@/lib/market/types";
import { ListQuerySchema } from "@/lib/validation/market";

export const metadata = { title: "Print the market list · Medicine Supply" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MarketListPrintPage({ searchParams }: PageProps<"/market-list/print">) {
  const { supabase } = await requirePageContext();
  const raw = await searchParams;
  const parsed = ListQuerySchema().safeParse({ date: first(raw.date), q: first(raw.q), status: first(raw.status), stores: first(raw.stores) });
  const params: ListParams = parsed.success
    ? { date: parsed.data.date, q: parsed.data.q, status: parsed.data.status, stores: parsed.data.stores }
    : ListQuerySchema().parse({});

  let list: MarketList | null = null;
  try {
    list = await getCompleteMarketList(supabase, params);
  } catch (error) {
    // A list that is too large is never printed cut short.
    if (!(error instanceof ApiError && error.code === "list_too_large")) throw error;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden" data-testid="print-toolbar">
        <Link href={marketScreenUrl(params)} className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ChevronLeft size={20} aria-hidden="true" /> Market list
        </Link>
        <PrintButton />
      </div>
      {list ? (
        <MarketPrintView list={list} selectedStoreIds={params.stores} />
      ) : (
        <Banner kind="error">Too many rows to print. Narrow the list with a store or a search.</Banner>
      )}
    </div>
  );
}
