import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { exportPage } from "@/lib/backup/export-repository";

// The signed-in business's stores and orders with their lines, for the backup file (Module 009). Runs as the user (row
// level security applies) and never returns a price, snapshot or any money column.

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  cursor: z.string().max(20).optional(),
});

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const page = await exportPage(supabase, query.limit, query.cursor);
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  });
}
