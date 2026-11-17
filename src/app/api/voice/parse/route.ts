import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { ParseBodySchema } from "@/lib/validation/voice";
import { parseTranscript } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

/**
 * Turns a transcript into a preview. The AI parser sees only the transcript text; the store and the medicines are
 * matched afterwards by application code against the business's own active records. Nothing is saved: the supplier
 * reviews and corrects the preview and creates the draft order only by their own tap. The raw AI answer, the request
 * and the key never leave the server.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const body = ParseBodySchema.parse(await readJson(request));
    return Response.json(await parseTranscript(supabase, body), { headers: { "Cache-Control": "no-store" } });
  });
}
