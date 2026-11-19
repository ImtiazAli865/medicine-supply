import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getRepeatPlan } from "@/lib/orders/fast-repository";
import { RepeatQuerySchema } from "@/lib/validation/fast-order";

// The lines to copy from the store's earlier order, and what had to be left out. Read-only: the new draft is
// created only by the normal order save, never here.
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = RepeatQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await getRepeatPlan(supabase, query.store_id, query.order_id), { headers: { "Cache-Control": "private, no-store" } });
  });
}
