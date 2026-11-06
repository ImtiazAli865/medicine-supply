import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { getSetupState } from "@/lib/setup/repository";

export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await getSetupState(supabase));
  });
}
