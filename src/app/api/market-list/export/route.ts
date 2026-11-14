import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { toCsv } from "@/lib/market/csv";
import { getCompleteMarketList } from "@/lib/market/repository";
import { ListQuerySchema } from "@/lib/validation/market";

export const dynamic = "force-dynamic";

/** CSV of the same rows as the list (one line per medicine and store). Never contains a cost or a price. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    const list = await getCompleteMarketList(supabase, query);
    return new Response(toCsv(list), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="market-list-${list.date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
