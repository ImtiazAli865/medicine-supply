import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { getProduct, updateProduct } from "@/lib/products/repository";
import { ProductUpdateSchema } from "@/lib/validation/product";

export async function GET(_request: Request, ctx: RouteContext<"/api/products/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const product = await getProduct(supabase, id);
    if (!product) throw notFound();
    return Response.json(product);
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/products/[id]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw notFound();
    const input = ProductUpdateSchema.parse(await readJson(request));
    return Response.json(await updateProduct(supabase, id, input));
  });
}
