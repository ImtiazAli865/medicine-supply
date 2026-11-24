import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getStoreReport } from "@/lib/reports/repository";
import { ListQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** Sales and both profit figures per store for a period. Internal: carries cost and profit. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getStoreReport(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
