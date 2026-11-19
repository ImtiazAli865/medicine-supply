import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listUsual } from "@/lib/orders/fast-repository";
import { UsualQuerySchema } from "@/lib/validation/fast-order";

// The store's usual medicines (up to 12) and its repeat source. Read-only, as the signed-in user.
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = UsualQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listUsual(supabase, query.store_id), { headers: { "Cache-Control": "private, no-store" } });
  });
}
