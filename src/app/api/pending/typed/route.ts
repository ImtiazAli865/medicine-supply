import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listTypedGroups } from "@/lib/pending/repository";
import { PendingListQuerySchema } from "@/lib/validation/pending";

export const dynamic = "force-dynamic";

/** Typed (not registered) order lines on draft and confirmed orders, grouped by what was typed. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = PendingListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listTypedGroups(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
