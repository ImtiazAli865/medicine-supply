import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { getStore, updateStore } from "@/lib/stores/repository";
import { StoreUpdateSchema } from "@/lib/validation/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/stores/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const store = await getStore(supabase, id);
    if (!store) throw notFound();
    return Response.json(store);
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/stores/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const input = StoreUpdateSchema.parse(await readJson(request));
    return Response.json(await updateStore(supabase, id, input));
  });
}
