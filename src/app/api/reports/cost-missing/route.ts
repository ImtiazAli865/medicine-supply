import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getCostMissing } from "@/lib/reports/repository";
import { PeriodQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** Sold medicines that have no cost for the estimated or the realized figure. Internal: carries sales amounts. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = PeriodQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getCostMissing(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
