import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound, readJson } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { removeStoreRate, setStoreRate } from "@/lib/rates/repository";
import { RateRemoveQuerySchema, RateSetSchema } from "@/lib/validation/rate";

export async function PUT(request: Request, ctx: RouteContext<"/api/stores/[id]/rates/[productId]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id, productId } = await ctx.params;
    if (!isUuid(id) || !isUuid(productId)) throw notFound();
    const input = RateSetSchema.parse(await readJson(request));
    return Response.json(await setStoreRate(supabase, id, productId, input.rate, input.expected_version));
  });
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/stores/[id]/rates/[productId]">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { id, productId } = await ctx.params;
    if (!isUuid(id) || !isUuid(productId)) throw notFound();
    const query = RateRemoveQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await removeStoreRate(supabase, id, productId, query.expected_version));
  });
}
