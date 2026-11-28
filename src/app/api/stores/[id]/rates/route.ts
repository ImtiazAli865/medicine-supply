import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { listStoreRates } from "@/lib/rates/repository";

export async function GET(_request: Request, ctx: RouteContext<"/api/stores/[id]/rates">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    return Response.json(await listStoreRates(supabase, id));
  });
}
