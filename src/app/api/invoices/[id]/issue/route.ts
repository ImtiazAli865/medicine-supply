import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { issueInvoice } from "@/lib/invoices/repository";
import { IssueInvoiceBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/**
 * Issues a draft: the next invoice number, a frozen invoice, the invoice entry on the store account, the optional
 * payment received now and a fulfilled order, atomically. A repeat on an already issued invoice returns it with
 * replayed = true, uses no number and records no second payment.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/issue">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = IssueInvoiceBodySchema.parse(await readJson(request));
    return Response.json(await issueInvoice(supabase, id, body.expected_version, body.payment_received));
  });
}
