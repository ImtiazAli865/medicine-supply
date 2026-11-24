import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getNotInAccount } from "@/lib/reports/repository";

export const dynamic = "force-dynamic";

/** How many issued invoices are in no store account (issued before store accounts existed), shown with the balances. */
export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await getNotInAccount(supabase), { headers: { "Cache-Control": "no-store" } });
  });
}
