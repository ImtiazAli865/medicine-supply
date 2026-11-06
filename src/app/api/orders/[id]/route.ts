import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderSaveSchema } from "@/lib/validation/order";

export async function GET(_request: Request, ctx: RouteContext<"/api/orders/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const order = await getOrder(supabase, id);
    if (!order) throw notFound();
    return Response.json(order);
  });
}

/**
 * Creates a draft, updates a draft, or saves edits to a confirmed order. The id is created on the device;
 * repeating the same request_id returns the stored result (200, replayed) instead of applying it again.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/orders/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const input = OrderSaveSchema.parse(await readJson(request));
    const { result, created } = await saveOrder(supabase, id, input);
    return Response.json(result, { status: created ? 201 : 200 });
  });
}
