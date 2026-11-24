import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAccountsSummary, listAccounts } from "@/lib/accounts/repository";
import { ApiError } from "@/lib/api/errors";
import { todayInPakistan } from "@/lib/orders/dates";
import {
  getCostMissing,
  getMedicineReport,
  getNotInAccount,
  getPurchaseReport,
  getSalesReport,
  getStoreReport,
} from "@/lib/reports/repository";
import { issueInvoiceWithClient, seedAccountStoreWithClient } from "../helpers/accounts";
import { recordArgs, recordBody } from "../helpers/market";
import { seedMedicineWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The report repository functions against the real Supabase test project, as real signed-in users with two businesses:
// sales, purchases, stores, medicines, cost missing, the not-in-account note and the balances (which must equal the Home
// figure). Needs migration 0011 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const TODAY = todayInPakistan();
const PERIOD = { from: `${TODAY.slice(0, 8)}01`, to: TODAY };

suite("reports on the real database", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;
  let storeB: string;

  beforeAll(async () => {
    a = await createTenant("reports-a");
    b = await createTenant("reports-b");
    storeA = await seedAccountStoreWithClient(a.client, "Al Madina Reports");
    storeB = await seedAccountStoreWithClient(b.client, "Zeta Reports Only B");
    await issueInvoiceWithClient(a.client, storeA, "1000.00");
    await issueInvoiceWithClient(a.client, storeA, "250.50");
    await issueInvoiceWithClient(b.client, storeB, "777.00");
    // A bought a medicine today with an actual cost.
    const product = await seedMedicineWithClient(a.client, { name: `Costed ${randomUUID().slice(0, 6)}`, unit: "strip", selling_price: "10.00" });
    const bought = await a.client.rpc("purchase_record", recordArgs(recordBody(product, TODAY, 4, { unit_cost: "12.50" })));
    expect(bought.data).toMatchObject({ done: true });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map((t) => deleteTenant(t)));
  });

  it("gives each owner only their own sales, with nothing from the other business", async () => {
    const mine = await getSalesReport(a.client, { ...PERIOD, group: "day" });
    expect(mine.totals).toMatchObject({ sales: "1250.50", invoices: 2 });
    const theirs = await getSalesReport(b.client, { ...PERIOD, group: "day" });
    expect(theirs.totals).toMatchObject({ sales: "777.00", invoices: 1 });
  });

  it("makes day, week and month add up to the same total", async () => {
    for (const group of ["day", "week", "month"] as const) {
      const r = await getSalesReport(a.client, { ...PERIOD, group });
      expect(r.totals.sales, group).toBe("1250.50");
      expect(r.series.reduce((sum, s) => sum + Math.round(Number(s.sales) * 100), 0), group).toBe(125050);
    }
  });

  it("lists the medicines without a cost in cost missing, and only mine", async () => {
    const r = await getCostMissing(a.client, PERIOD);
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.items.every((i) => i.estimate_missing && i.realized_missing)).toBe(true);
    const names = r.items.map((i) => i.name).join("|");
    expect(names).not.toContain("Zeta");
  });

  it("shows stores and medicines, each adding up to the summary", async () => {
    const stores = await getStoreReport(a.client, { ...PERIOD, q: "", sort: "sales", limit: 20, offset: 0 });
    expect(stores.items.map((s) => s.name)).toEqual(["Al Madina Reports"]);
    expect(stores.totals.sales).toBe("1250.50");
    const medicines = await getMedicineReport(a.client, { ...PERIOD, q: "", sort: "sales", limit: 20, offset: 0 });
    expect(medicines.totals.sales).toBe("1250.50");
    expect(medicines.items.reduce((sum, m) => sum + Math.round(Number(m.sales) * 100), 0)).toBe(125050);
  });

  it("counts a purchase with an actual cost, and not another business's purchases", async () => {
    const mine = await getPurchaseReport(a.client, { ...PERIOD, group: "day" });
    expect(mine.totals).toMatchObject({ cost: "50.00", entries: 1, entries_without_cost: 0, status: "complete" });
    const theirs = await getPurchaseReport(b.client, { ...PERIOD, group: "day" });
    expect(theirs.totals).toMatchObject({ cost: "0.00", entries: 0 });
  });

  it("says every invoice here is in an account", async () => {
    expect(await getNotInAccount(a.client)).toEqual({ invoices: 0, total: "0.00" });
  });

  it("refuses a bad period with a message that names the problem", async () => {
    await expect(getSalesReport(a.client, { from: "2026-11-20", to: "2026-11-01", group: "day" })).rejects.toMatchObject({ code: "validation_error" });
    await expect(getSalesReport(a.client, { from: "2999-01-01", to: "2999-01-31", group: "day" })).rejects.toBeInstanceOf(ApiError);
    await expect(getSalesReport(a.client, { from: "2020-01-01", to: TODAY, group: "day" })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("gives balances through the account functions, with the total equal to the Home figure", async () => {
    const summary = await getAccountsSummary(a.client);
    const page = await listAccounts(a.client, { q: "", only_owing: false, limit: 50, offset: 0 });
    const owed = page.items.filter((i) => Number(i.balance) > 0).reduce((sum, i) => sum + Math.round(Number(i.balance) * 100), 0);
    expect(summary.total_owed).toBe((owed / 100).toFixed(2));
    expect(summary.total_owed).toBe("1250.50");
    expect(page.items.map((i) => i.name)).not.toContain("Zeta Reports Only B");
  });

  it("cannot be called by a signed-out client", async () => {
    const { anonClient } = await import("../helpers/supabase-test");
    const res = await anonClient().rpc("report_sales", { p_from: PERIOD.from, p_to: PERIOD.to, p_group: "day" });
    expect(res.error).not.toBeNull();
  });
});
