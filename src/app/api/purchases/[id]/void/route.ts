import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { voidPurchase } from "@/lib/market/repository";
import { VoidPurchaseBodySchema } from "@/lib/validation/market";

/** Cancels one purchase entry with a reason. The entry stays in the history; cancelling twice cancels once. */
export async function POST(request: Request, ctx: RouteContext<"/api/purchases/[id]/void">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = VoidPurchaseBodySchema.parse(await readJson(request));
    return Response.json(await voidPurchase(supabase, id, body));
  });
}
