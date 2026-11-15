import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { getInvoice, updateQuantities } from "@/lib/invoices/repository";
import { UpdateQuantitiesBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    return Response.json(await getInvoice(supabase, id), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Changes the delivered (billed) quantities of a draft. The ordered quantity is never touched. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = UpdateQuantitiesBodySchema.parse(await readJson(request));
    return Response.json(await updateQuantities(supabase, id, body));
  });
}
