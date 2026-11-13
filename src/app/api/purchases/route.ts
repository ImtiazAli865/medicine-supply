import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { listPurchases, recordPurchase } from "@/lib/market/repository";
import { PurchaseQuerySchema, RecordPurchaseBodySchema } from "@/lib/validation/market";

export const dynamic = "force-dynamic";

/** The purchase entries of one medicine, unit and date, cancelled ones included (the purchase recording screen). */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = PurchaseQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listPurchases(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Records one purchase. The body's id is the request id: repeating the request returns the stored entry. */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const body = RecordPurchaseBodySchema().parse(await readJson(request));
    return Response.json(await recordPurchase(supabase, body));
  });
}
