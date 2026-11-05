import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { readJsonBodyCapped } from "@/lib/api/body";
import { handle } from "@/lib/api/errors";
import { applyImport, listImports } from "@/lib/imports/repository";
import { ApplyRequestSchema, ImportListQuerySchema } from "@/lib/validation/import";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ImportListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listImports(supabase, query.limit));
  });
}

// Confirm and apply: all-or-nothing, idempotent on import_id (a repeat returns 200 with the original result).
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const input = ApplyRequestSchema.parse(await readJsonBodyCapped(request));
    const result = await applyImport(supabase, input);
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  });
}
