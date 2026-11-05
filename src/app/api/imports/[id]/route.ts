import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { getImport } from "@/lib/imports/repository";

export async function GET(_request: Request, ctx: RouteContext<"/api/imports/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const found = await getImport(supabase, id);
    if (!found) throw notFound(); // also for another business's id: it is never revealed
    return Response.json(found);
  });
}
