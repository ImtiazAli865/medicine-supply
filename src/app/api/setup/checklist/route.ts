import { requireBusinessUser } from "@/lib/api/auth";
import { handle, readJson } from "@/lib/api/errors";
import { setChecklistDismissed } from "@/lib/setup/repository";
import { ChecklistDismissSchema } from "@/lib/validation/settings";

export async function PATCH(request: Request) {
  return handle(async () => {
    const { supabase, businessId } = await requireBusinessUser();
    const { dismissed } = ChecklistDismissSchema.parse(await readJson(request));
    return Response.json(await setChecklistDismissed(supabase, businessId, dismissed));
  });
}
