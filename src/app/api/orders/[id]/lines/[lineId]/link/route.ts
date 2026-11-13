import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { linkLine } from "@/lib/pending/repository";
import { LinkBodySchema } from "@/lib/validation/pending";

/** Link a typed line to an existing medicine the supplier picked and confirmed. Changes only this line. */
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/lines/[lineId]/link">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id, lineId } = await ctx.params;
    if (!isUuid(id) || !isUuid(lineId)) throw notFound();
    const input = LinkBodySchema.parse(await readJson(request));
    return Response.json(await linkLine(supabase, id, lineId, input));
  });
}
