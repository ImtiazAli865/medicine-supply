import { requireBusinessUser } from "@/lib/api/auth";
import { readJsonBodyCapped } from "@/lib/api/body";
import { handle } from "@/lib/api/errors";
import { previewImport } from "@/lib/imports/repository";
import { PreviewRequestSchema } from "@/lib/validation/import";

// Read-only: classifies the rows against the caller's catalog. Nothing is saved.
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const input = PreviewRequestSchema.parse(await readJsonBodyCapped(request));
    return Response.json(await previewImport(supabase, input.rows));
  });
}
