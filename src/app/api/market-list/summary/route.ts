import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getMarketSummary } from "@/lib/market/repository";
import { SummaryQuerySchema } from "@/lib/validation/market";

export const dynamic = "force-dynamic";

/** Counts for the Home card. They come from the same rows as the list, so they always match it. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { date } = SummaryQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getMarketSummary(supabase, date), { headers: { "Cache-Control": "no-store" } });
  });
}
