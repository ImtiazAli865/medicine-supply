import { getAccount } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { AccountQuerySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/** One store account: the balance, the open items and a page of entries (newest first) with the running balance. */
export async function GET(request: Request, ctx: RouteContext<"/api/accounts/[storeId]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const query = AccountQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getAccount(supabase, storeId, query), { headers: { "Cache-Control": "no-store" } });
  });
}
