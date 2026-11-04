import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { createProduct, listProducts } from "@/lib/products/repository";
import { ProductCreateSchema } from "@/lib/validation/product";
import { ListQuerySchema } from "@/lib/validation/store";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listProducts(supabase, query));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const input = ProductCreateSchema.parse(await readJson(request));
    const { result, created } = await createProduct(supabase, input);
    return Response.json(result, { status: created ? 201 : 200 });
  });
}
