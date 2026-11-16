import { getAccountsSummary } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

/** Total owed by stores, how many stores owe, and the same for advances. Worked out from the entries, never stored. */
export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await getAccountsSummary(supabase), { headers: { "Cache-Control": "no-store" } });
  });
}
