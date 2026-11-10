import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, notFound } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { previewPriceFill } from "@/lib/pending/repository";
import { PriceQuerySchema } from "@/lib/validation/pending";

/** The exact order lines a price would fill. Reads only; nothing is saved. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/pending/prices/[productId]/preview">) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { productId } = await ctx.params;
    if (!isUuid(productId)) throw notFound();
    const { price } = PriceQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await previewPriceFill(supabase, productId, price));
  });
}
