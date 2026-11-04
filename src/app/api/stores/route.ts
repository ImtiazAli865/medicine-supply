import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { createStore, listStores } from "@/lib/stores/repository";
import { ListQuerySchema, StoreCreateSchema } from "@/lib/validation/store";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listStores(supabase, query));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const input = StoreCreateSchema.parse(await readJson(request));
    const { store, created } = await createStore(supabase, input);
    return Response.json(store, { status: created ? 201 : 200 });
  });
}
