import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { registerLine } from "@/lib/pending/repository";
import { RegisterBodySchema } from "@/lib/validation/pending";

/** Quick Register: create a medicine from a typed line and link the line to it, all or nothing. */
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/lines/[lineId]/register">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id, lineId } = await ctx.params;
    if (!isUuid(id) || !isUuid(lineId)) throw notFound();
    const input = RegisterBodySchema.parse(await readJson(request));
    return Response.json(await registerLine(supabase, id, lineId, input));
  });
}
