import { previewPayment } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { PaymentPreviewQuerySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/** What a payment would do: the balance after it and the items it would settle, oldest first. Nothing is written. */
export async function GET(request: Request, ctx: RouteContext<"/api/accounts/[storeId]/payment-preview">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { storeId } = await ctx.params;
    if (!isUuid(storeId)) throw notFound();
    const query = PaymentPreviewQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await previewPayment(supabase, storeId, query.amount), { headers: { "Cache-Control": "no-store" } });
  });
}
