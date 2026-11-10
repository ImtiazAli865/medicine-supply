import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { applyPriceFill } from "@/lib/pending/repository";
import { PriceApplyBodySchema } from "@/lib/validation/pending";

/**
 * Saves the price once and gives it to exactly the reviewed lines (only lines without a price), all or nothing.
 * Repeating the same request_id returns the stored result instead of applying it again.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/pending/prices/[productId]/apply">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { productId } = await ctx.params;
    if (!isUuid(productId)) throw notFound();
    const input = PriceApplyBodySchema.parse(await readJson(request));
    return Response.json(await applyPriceFill(supabase, productId, input));
  });
}
