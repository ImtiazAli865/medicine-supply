import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getMarketList } from "@/lib/market/repository";
import { ListQuerySchema } from "@/lib/validation/market";

// Never cached: the totals must match the orders as they are right now.
export const dynamic = "force-dynamic";

/** The consolidated market list of one Pakistan day (default today). No price or cost is ever returned. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getMarketList(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
