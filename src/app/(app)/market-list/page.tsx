import { Suspense } from "react";
import { MarketListWithActions } from "@/components/market/MarketListWithActions";
import { LoadingBlock } from "@/components/ui/Spinner";
import { requirePageContext } from "@/lib/api/auth";
import type { ListParams } from "@/lib/market/client";
import { ListQuerySchema } from "@/lib/validation/market";

export const metadata = { title: "Market list · Medicine Supply" };
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MarketListPage({ searchParams }: PageProps<"/market-list">) {
  await requirePageContext();
  const raw = await searchParams;
  // A bad value in the address falls back to the default instead of breaking the page.
  const parsed = ListQuerySchema().safeParse({ date: first(raw.date), q: first(raw.q), status: first(raw.status), stores: first(raw.stores) });
  const initial: ListParams = parsed.success
    ? { date: parsed.data.date, q: parsed.data.q, status: parsed.data.status, stores: parsed.data.stores }
    : ListQuerySchema().parse({});
  return (
    <Suspense fallback={<LoadingBlock label="Loading the market list…" />}>
      <MarketListWithActions initial={initial} />
    </Suspense>
  );
}
