import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getSalesReport } from "@/lib/reports/repository";
import { SeriesQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** Sales, estimated and realized profit and a time series for a period. Internal: carries cost and profit. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = SeriesQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getSalesReport(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
