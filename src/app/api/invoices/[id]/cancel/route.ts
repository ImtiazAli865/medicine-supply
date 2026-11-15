import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { cancelInvoice } from "@/lib/invoices/repository";
import { CancelInvoiceBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/** Cancels an issued invoice with a required reason. The order returns to Confirmed. A repeat keeps the first reason. */
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/cancel">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = CancelInvoiceBodySchema.parse(await readJson(request));
    return Response.json(await cancelInvoice(supabase, id, body.reason));
  });
}
