import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { refreshInvoice } from "@/lib/invoices/repository";
import { VersionBodySchema } from "@/lib/validation/invoice";

export const dynamic = "force-dynamic";

/** Rebuilds a stale draft from its order. Delivered quantities return to the order line values. */
export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]/refresh">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const body = VersionBodySchema.parse(await readJson(request));
    return Response.json(await refreshInvoice(supabase, id, body.expected_version));
  });
}
