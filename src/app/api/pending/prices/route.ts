import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listPendingPrices } from "@/lib/pending/repository";
import { PendingListQuerySchema } from "@/lib/validation/pending";

/** Active medicines without a selling price, and priced ones that still have confirmed lines waiting for a price. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = PendingListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listPendingPrices(supabase, query));
  });
}
