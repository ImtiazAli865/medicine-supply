import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { pendingCandidates } from "@/lib/pending/repository";
import { PendingProductQuerySchema } from "@/lib/validation/pending";

/** Typed lines that clearly match a medicine (proposed) and look-alikes (never proposed). Reads only. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { product_id } = PendingProductQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await pendingCandidates(supabase, product_id));
  });
}
