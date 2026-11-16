import { addAdjustment } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { AdjustmentBodySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/**
 * Reduces or increases what the store owes by a small amount. A reason (1 to 500 characters) is required and shows in
 * the history and on the statement. The body id is the request id: repeating it returns the stored entry.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/adjustments">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const body = AdjustmentBodySchema.parse(await readJson(request));
    return Response.json(await addAdjustment(supabase, storeId, body));
  });
}
