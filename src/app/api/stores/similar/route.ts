import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { findStoresByName } from "@/lib/stores/repository";

const QuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  excludeId: z.uuid().optional(),
});

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const { name, excludeId } = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json({ items: await findStoresByName(supabase, name, excludeId) });
  });
}
