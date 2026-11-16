import { listAccounts } from "@/lib/accounts/repository";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { AccountListQuerySchema } from "@/lib/validation/account";

export const dynamic = "force-dynamic";

/** Every store with its balance (stores without entries show 0.00), the stores that owe first. */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = AccountListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listAccounts(supabase, query), { headers: { "Cache-Control": "no-store" } });
  });
}
