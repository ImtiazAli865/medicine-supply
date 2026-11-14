import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listToInvoice } from "@/lib/invoices/repository";
import { ToInvoiceQuerySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/** The confirmed orders that still need an invoice. The Home count is the length of this list. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ToInvoiceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listToInvoice(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
