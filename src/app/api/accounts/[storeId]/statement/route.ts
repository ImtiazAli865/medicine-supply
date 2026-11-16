import { getStatement } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { StatementQuerySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/**
 * The Store Statement for a date range: the opening balance on the start date, every entry in the range with its
 * running balance, the totals and the closing balance. It has no purchase price, MRP, cost, margin or profit.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/statement">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const query = StatementQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getStatement(supabase, storeId, query), { headers: { "Cache-Control": "no-store" } });
  });
}
