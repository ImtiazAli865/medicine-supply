import { addOpeningBalance } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { OpeningBalanceBodySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/**
 * Adds an opening balance as on a date, on any day. The body id is the request id: repeating it returns the stored
 * entry with replayed = true, and the same id with different content is refused (request_reused).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/opening-balances">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const body = OpeningBalanceBodySchema.parse(await readJson(request));
    return Response.json(await addOpeningBalance(supabase, storeId, body));
  });
}
