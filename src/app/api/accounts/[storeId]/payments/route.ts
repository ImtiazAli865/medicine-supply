import { recordPayment } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { PaymentBodySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/**
 * Records a payment received from the store (cash for now). The body id is the request id: repeating it returns the
 * stored entry with replayed = true, the balance falls once, and the same id with different content is refused
 * (request_reused). A payment belongs to the store account, never to one invoice.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/payments">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const body = PaymentBodySchema.parse(await readJson(request));
    return Response.json(await recordPayment(supabase, storeId, body));
  });
}
