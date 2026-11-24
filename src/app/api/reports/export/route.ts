import { balancesCsv, costMissingCsv, medicinesCsv, purchasesCsv, salesCsv, storesCsv } from "@/lib/reports/csv";
import { getAccountsSummary, listAccounts } from "@/lib/accounts/repository";
import type { AccountRow } from "@/lib/accounts/types";
import { requireBusinessUser } from "@/lib/api/auth";
import { ApiError, handle } from "@/lib/api/errors";
import { todayInPakistan } from "@/lib/orders/dates";
import { getCostMissing, getMedicineReport, getNotInAccount, getPurchaseReport, getSalesReport, getStoreReport } from "@/lib/reports/repository";
import { ExportQuerySchema } from "@/lib/reports/validation";

export const dynamic = "force-dynamic";

/** The most rows one export holds; more is refused so a file is never cut short. */
const EXPORT_ROWS = 5000;
const TOO_LARGE = "Too many rows to export. Narrow the report with a search or a shorter period.";

function csvResponse(file: string, name: string): Response {
  return new Response(file, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * CSV of the report on the screen: the same function, period and filters, so the file equals the screen. Internal:
 * carries cost and profit. A file that would be cut short is refused (list_too_large), never sent partly.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const { supabase } = await requireBusinessUser();
    const query = ExportQuerySchema().parse(Object.fromEntries(new URL(request.url).searchParams));

    if (query.report === "balances") {
      const today = todayInPakistan();
      const rows: AccountRow[] = [];
      for (let offset = 0; ; offset += 50) {
        const page = await listAccounts(supabase, { q: "", only_owing: false, limit: 50, offset });
        rows.push(...page.items);
        if (rows.length > EXPORT_ROWS) throw new ApiError("list_too_large", TOO_LARGE);
        if (page.items.length < 50 || rows.length >= page.total) break;
      }
      const [summary, note] = await Promise.all([getAccountsSummary(supabase), getNotInAccount(supabase)]);
      return csvResponse(balancesCsv(today, rows, summary, note), `report-balances-${today}.csv`);
    }

    // Every other report has a period (the schema refuses a missing one).
    const from = query.from as string;
    const to = query.to as string;
    const name = (report: string) => `report-${report}-${from}-${to}.csv`;
    const list = { from, to, q: query.q, sort: query.sort, limit: EXPORT_ROWS + 1, offset: 0 };

    switch (query.report) {
      case "sales":
        return csvResponse(salesCsv(await getSalesReport(supabase, { from, to, group: query.group })), name("sales"));
      case "purchases":
        return csvResponse(purchasesCsv(await getPurchaseReport(supabase, { from, to, group: query.group })), name("purchases"));
      case "stores": {
        const report = await getStoreReport(supabase, list);
        if (report.total > EXPORT_ROWS) throw new ApiError("list_too_large", TOO_LARGE);
        return csvResponse(storesCsv(report), name("stores"));
      }
      case "medicines": {
        const report = await getMedicineReport(supabase, list);
        if (report.total > EXPORT_ROWS) throw new ApiError("list_too_large", TOO_LARGE);
        return csvResponse(medicinesCsv(report), name("medicines"));
      }
      case "cost-missing": {
        const report = await getCostMissing(supabase, { from, to });
        if (report.truncated) throw new ApiError("list_too_large", TOO_LARGE);
        return csvResponse(costMissingCsv(report), name("cost-missing"));
      }
    }
  });
}
