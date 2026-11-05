import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { getSettings, saveSettings } from "@/lib/settings/repository";
import { SettingsUpdateSchema } from "@/lib/validation/settings";

export async function GET() {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    return Response.json(await getSettings(supabase));
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const input = SettingsUpdateSchema.parse(await readJson(request));
    return Response.json(await saveSettings(supabase, input));
  });
}
