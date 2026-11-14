import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { discardInvoice } from "@/lib/invoices/repository";
import { VersionBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/** Discards a draft (no invoice number was ever used). An issued invoice cannot be discarded, only cancelled. */
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/discard">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = VersionBodySchema.parse(await readJson(request));
    return Response.json(await discardInvoice(supabase, id, body.expected_version));
  });
}
