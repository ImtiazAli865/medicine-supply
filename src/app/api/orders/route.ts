import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listOrders } from "@/lib/orders/repository";
import { OrderListQuerySchema } from "@/lib/validation/order";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = OrderListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listOrders(supabase, query));
  });
}
