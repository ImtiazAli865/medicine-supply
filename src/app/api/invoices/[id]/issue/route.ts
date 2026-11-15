import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { issueInvoice } from "@/lib/invoices/repository";
import { VersionBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/**
 * Issues a draft: the next invoice number, a frozen invoice and a fulfilled order, atomically. A repeat on an
 * already issued invoice returns it with replayed = true and uses no number.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/issue">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = VersionBodySchema.parse(await readJson(request));
    return Response.json(await issueInvoice(supabase, id, body.expected_version));
  });
}
