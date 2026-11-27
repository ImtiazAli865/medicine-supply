import type { NextRequest } from "next/server";
import { requireBusinessUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/errors";
import { listAllRates } from "@/lib/rates/repository";
import { DEVICE_RATE_PAGE } from "@/lib/rates/types";
import { RatesPageQuerySchema } from "@/lib/validation/rate";

/** Every saved rate, page by page, for the copy kept on the phone (selling prices only). */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = RatesPageQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(await listAllRates(supabase, query.limit ?? DEVICE_RATE_PAGE, query.cursor));
  });
}
