import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { confirmOrder } from "@/lib/orders/repository";
import { OrderActionSchema } from "@/lib/validation/order";

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/confirm">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const input = OrderActionSchema.parse(await readJson(request));
    return Response.json(await confirmOrder(supabase, id, input));
  });
}
