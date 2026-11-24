import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbReportNotInAccount, insertStore, seedIssuedInvoice, seedMedicine, withoutTriggers } from "../helpers/reports-db";

// The note shown with Outstanding balances (spec FR-017): issued invoices that are in no store account (issued before
// Module 007), counted and totalled; drafts, cancelled invoices and invoices in the account are not.

let db: PGlite;
let t: Tenant;

async function makeLegacy(invoiceId: string): Promise<void> {
  await withoutTriggers(db, async () => {
    await db.query(`update public.invoices set in_account = false, summary_previous = null, summary_payment = null, summary_due = null where id = $1`, [invoiceId]);
  });
}

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, "notinaccount");
  const store = await insertStore(db, t.businessId, "S");
  const p = await seedMedicine(db, t.businessId, { name: "Old stock" });
  const inAccount = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-04-01", lines: [{ product: p, qty: 1, price: "1000.00" }] });
  const legacyA = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-04-02", lines: [{ product: p, qty: 2, price: "100.00" }] });
  const legacyB = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-04-03", lines: [{ product: p, qty: 1, price: "50.50" }] });
  const cancelled = await seedIssuedInvoice(db, t, { storeId: store, date: "2026-04-04", lines: [{ product: p, qty: 1, price: "7.00" }], status: "cancelled" });
  await seedIssuedInvoice(db, t, { storeId: store, date: "2026-04-05", lines: [{ product: p, qty: 1, price: "9.00" }], status: "draft" });
  void inAccount;
  await makeLegacy(legacyA.invoiceId);
  await makeLegacy(legacyB.invoiceId);
  await makeLegacy(cancelled.invoiceId); // a cancelled legacy invoice is still not counted
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("not in the account", () => {
  it("counts and totals the issued invoices that are in no account, and nothing else", async () => {
    const r = await dbReportNotInAccount(db, t.userId);
    expect(r).toEqual({ invoices: 2, total: "250.50" });
  });

  it("says zero for a business with none, and never shows another business's invoices", async () => {
    const other = await createTenant(db, "notinaccount-other");
    expect(await dbReportNotInAccount(db, other.userId)).toEqual({ invoices: 0, total: "0.00" });
  });

  it("refuses a user without a business", async () => {
    const orphan = await db.query<{ id: string }>(`insert into auth.users (email) values ('orphan-nia@example.test') returning id`);
    await expect(dbReportNotInAccount(db, orphan.rows[0].id)).rejects.toThrow(/no_business/);
  });
});
