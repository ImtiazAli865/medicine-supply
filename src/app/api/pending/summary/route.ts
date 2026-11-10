import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { pendingSummary } from "@/lib/pending/repository";

// Never cached: the counts must match what the lists show right now.
export const dynamic = "force-dynamic";

/** Counts for Home: typed lines and groups, medicines that need a price, and the lines waiting for one. */
export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await pendingSummary(supabase), { headers: { "Cache-Control": "no-store" } });
  });
}
