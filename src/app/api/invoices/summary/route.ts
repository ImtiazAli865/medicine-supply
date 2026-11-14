import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getInvoiceSummary } from "@/lib/invoices/repository";

export const dynamic = "force-dynamic";

/** Counts for the Home card. `to_invoice` is the length of the "to invoice" list. */
export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await getInvoiceSummary(supabase), { headers: { "Cache-Control": "no-store" } });
  });
}
