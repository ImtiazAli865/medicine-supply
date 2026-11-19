import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listMedicinesPage, searchMedicines } from "@/lib/orders/fast-repository";
import { MedicinesQuerySchema } from "@/lib/validation/fast-order";

// Active medicines in a slim shape (no purchase price, MRP or cost). Without q it pages the whole active catalog;
// with q it is a server search of at most 30 rows. Read-only, as the signed-in user.
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = MedicinesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = query.q === null ? await listMedicinesPage(supabase, query.limit, query.cursor) : await searchMedicines(supabase, query.q, query.limit, query.cursor);
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  });
}
