import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { DiagnosticsQuerySchema } from "@/lib/validation/voice";
import { listDiagnostics } from "@/lib/voice/repository";

export const dynamic = "force-dynamic";

/**
 * The voice diagnostic log of the signed-in business, newest first. Read only: records hold the kind, the parser, counts
 * and the length of the text, never what was said, a price, a balance, a key or an upstream answer.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = DiagnosticsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listDiagnostics(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
