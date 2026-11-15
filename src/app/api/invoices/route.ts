import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { createInvoice, listInvoices } from "@/lib/invoices/repository";
import { CreateInvoiceBodySchema, InvoiceListQuerySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/** A page of invoices, newest first, with filters and a search (the Invoices screen). */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = InvoiceListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listInvoices(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Creates the draft of a confirmed order. The body id is the request id: repeating it returns the stored draft. */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const body = CreateInvoiceBodySchema.parse(await readJson(request));
    return Response.json(await createInvoice(supabase, body));
  });
}
