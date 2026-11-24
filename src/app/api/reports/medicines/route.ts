import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getMedicineReport } from "@/lib/reports/repository";
import { ListQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** Sales and both profit figures per medicine and unit for a period. Internal: carries cost and profit. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getMedicineReport(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
