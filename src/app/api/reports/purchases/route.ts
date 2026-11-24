import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getPurchaseReport } from "@/lib/reports/repository";
import { SeriesQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** The money spent at the market in a period, from actual quantities and actual unit costs. Internal: carries costs. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = SeriesQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getPurchaseReport(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
