import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import {
  dbReportByMedicine,
  dbReportByStore,
  dbReportCostMissing,
  dbReportNotInAccount,
  dbReportPurchases,
  dbReportSales,
  dbSalesLines,
  insertStore,
  seedIssuedInvoice,
  seedMedicine,
  seedPurchase,
  withoutTriggers,
} from "../helpers/reports-db";

// Isolation of every report function (spec FR-023, SC-004): two businesses with different data, a crafted business id,
// a signed-out caller, a caller without a business, and "nothing is written". Each later story adds its functions to
// CALLS.

let db: PGlite;
let a: Tenant;
let b: Tenant;

const PERIOD: [string, string] = ["2026-03-01", "2026-03-31"];

// One entry per report function: how to call it as a given user and how to read its sales figure (a string, "0.00" or a count)
// so the two businesses can be told apart.
const CALLS: Array<{ name: string; call: (userId: string) => Promise<unknown>; mine: (r: unknown, tenant: "a" | "b") => void }> = [
  {
    name: "report_sales",
    call: (u) => dbReportSales(db, u, PERIOD[0], PERIOD[1]),
    mine: (r, who) => expect((r as { totals: { sales: string } }).totals.sales).toBe(who === "a" ? "100.00" : "777.00"),
  },
  {
    name: "report_cost_missing",
    call: (u) => dbReportCostMissing(db, u, PERIOD[0], PERIOD[1]),
    mine: (r, who) => expect((r as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([who === "a" ? "Alpha medicine" : "Beta medicine"]),
  },
  {
    name: "report_purchases",
    call: (u) => dbReportPurchases(db, u, PERIOD[0], PERIOD[1]),
    mine: (r, who) => expect((r as { totals: { cost: string } }).totals.cost).toBe(who === "a" ? "50.00" : "27.00"),
  },
  {
    name: "report_by_store",
    call: (u) => dbReportByStore(db, u, { from: PERIOD[0], to: PERIOD[1] }),
    mine: (r, who) => expect((r as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([who === "a" ? "Store A" : "Store B"]),
  },
  {
    name: "report_by_medicine",
    call: (u) => dbReportByMedicine(db, u, { from: PERIOD[0], to: PERIOD[1] }),
    mine: (r, who) => expect((r as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([who === "a" ? "Alpha medicine" : "Beta medicine"]),
  },
  {
    name: "report_not_in_account",
    call: (u) => dbReportNotInAccount(db, u),
    mine: (r, who) => expect((r as { invoices: number }).invoices).toBe(who === "a" ? 1 : 0), // A has one legacy invoice, B none
  },
];
export { CALLS };

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "rls-a");
  b = await createTenant(db, "rls-b");
  const storeA = await insertStore(db, a.businessId, "Store A");
  const storeB = await insertStore(db, b.businessId, "Store B");
  const pa = await seedMedicine(db, a.businessId, { name: "Alpha medicine" });
  const pb = await seedMedicine(db, b.businessId, { name: "Beta medicine" });
  await seedPurchase(db, a.userId, { product: pa, date: "2026-03-05", qty: 10, unitCost: "5.00" });
  await seedPurchase(db, b.userId, { product: pb, date: "2026-03-06", qty: 3, unitCost: "9.00" });
  const invA = await seedIssuedInvoice(db, a, { storeId: storeA, date: "2026-03-05", lines: [{ product: pa, qty: 10, price: "10.00" }] });
  // A's invoice counts as issued before the store accounts module (it is in no account); B's is in B's account.
  await withoutTriggers(db, async () => {
    await db.query(`update public.invoices set in_account = false, summary_previous = null, summary_payment = null, summary_due = null where id = $1`, [invA.invoiceId]);
  });
  await seedIssuedInvoice(db, b, { storeId: storeB, date: "2026-03-05", lines: [{ product: pb, qty: 7, price: "111.00" }] });
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("every report function returns only the signed-in business's data", () => {
  for (const c of CALLS) {
    it(`${c.name}: A sees A, B sees B`, async () => {
      c.mine(await c.call(a.userId), "a");
      c.mine(await c.call(b.userId), "b");
    });
  }
});

describe("crafted ids and callers", () => {
  it("returns nothing from the base function when it is called with the other business's id", async () => {
    expect(await dbSalesLines(db, a.userId, a.businessId, ...PERIOD)).toHaveLength(1);
    expect(await dbSalesLines(db, a.userId, b.businessId, ...PERIOD)).toEqual([]);
    expect(await dbSalesLines(db, b.userId, a.businessId, ...PERIOD)).toEqual([]);
  });

  it("refuses a caller who is not signed in and a signed-in user without a business", async () => {
    await expect(
      withRole(db, "anon", null, async () => db.query(`select public.report_sales('2026-03-01', '2026-03-31', 'day')`)),
    ).rejects.toThrow(/permission denied/i);
    const orphan = await db.query<{ id: string }>(`insert into auth.users (email) values ('orphan@example.test') returning id`);
    await expect(dbReportSales(db, orphan.rows[0].id, ...PERIOD)).rejects.toThrow(/no_business/);
    await expect(dbReportCostMissing(db, orphan.rows[0].id, ...PERIOD)).rejects.toThrow(/no_business/);
  });
});

describe("nothing is written", () => {
  it("leaves every table's row count unchanged after calling every function, as both businesses", async () => {
    const counts = async () => {
      const res = await db.query<{ t: string; n: number }>(
        `select table_name as t, (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(table_name), false, true, '')))[1]::text::int as n
           from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
      );
      return res.rows.map((r) => `${r.t}:${r.n}`);
    };
    const before = await counts();
    for (const c of CALLS) {
      await c.call(a.userId);
      await c.call(b.userId);
    }
    expect(await counts()).toEqual(before);
  });
});
