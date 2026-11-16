import { reverseEntry } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { ReverseBodySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/**
 * Reverses a payment, an opening balance or an adjustment with a required reason. The body id is the id of the new
 * reversal entry (the request id). An invoice entry cannot be reversed here (cancel the invoice), a reversal cannot be
 * reversed, and an entry can be reversed once. The store in the address must be the entry's own store.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/entries/[entryId]/reverse">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId, entryId } = await ctx.params;
    if (!isUuid(storeId) || !isUuid(entryId)) throw notFound();
    const body = ReverseBodySchema.parse(await readJson(request));
    // The store in the address must be the entry's own store; otherwise the entry looks missing.
    return Response.json(await reverseEntry(supabase, storeId, entryId, body));
  });
}
