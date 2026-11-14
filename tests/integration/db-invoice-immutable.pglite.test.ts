import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvoiceDraft, dbInvoiceGet, issueInvoice, seedInvoiceOrder } from "../helpers/invoices-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// After issue nothing can change an invoice: not a direct write, not a later edit of a product, store or business.

let db: PGlite;
let a: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function issued() {
  const seed = await seedInvoiceOrder(db, a, { storeName: "Al Madina Medical" });
  const draft = await createInvoiceDraft(db, a.userId, seed.order.id);
  const inv = await issueInvoice(db, a.userId, draft);
  return { seed, inv };
}

describe("an issued invoice", () => {
  it("is unchanged byte for byte after the product, store, business and settings are edited", async () => {
    const { seed, inv } = await issued();
    const before = await dbInvoiceGet(db, a.userId, inv.id);

    await db.query(`update public.products set name = 'Renamed medicine', selling_price = '1.00', purchase_price = '1.00' where id = $1`, [seed.seeded.pricedId]);
    await db.query(`update public.products set selling_price = '999.00' where id = $1`, [seed.seeded.sellingOnlyId]);
    await db.query(`update public.stores set name = 'Renamed store', phone = '000', address = 'Elsewhere', contact_person = 'Someone else' where id = $1`, [seed.seeded.storeId]);
    await db.query(`update public.businesses set name = 'Renamed business' where id = $1`, [a.businessId]);
    await db.query(`update public.business_settings set phone = '999', address = 'New address' where business_id = $1`, [a.businessId]);

    const after = await dbInvoiceGet(db, a.userId, inv.id);
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after).toMatchObject({ found: true, business: { name: "a business" }, store: { name: "Al Madina Medical" } });
  });

  it("refuses every direct change to the invoice, its lines and its history, even by the table owner", async () => {
    const { inv } = await issued();
    const line = inv.lines[0].id;
    const attempts = [
      `update public.invoices set grand_total = 1 where id = '${inv.id}'`,
      `update public.invoices set invoice_number = 999999 where id = '${inv.id}'`,
      `update public.invoices set invoice_date = '2000-01-01' where id = '${inv.id}'`,
      `update public.invoices set business_name = 'X' where id = '${inv.id}'`,
      `update public.invoices set store_name = 'X' where id = '${inv.id}'`,
      `update public.invoices set status = 'draft' where id = '${inv.id}'`,
      `update public.invoices set status = 'issued' where id = '${inv.id}'`,
      `delete from public.invoices where id = '${inv.id}'`,
      `update public.invoice_lines set delivered_quantity = 1 where id = '${line}'`,
      `update public.invoice_lines set selling_price = 1 where id = '${line}'`,
      `update public.invoice_lines set name = 'X' where id = '${line}'`,
      `delete from public.invoice_lines where id = '${line}'`,
      `insert into public.invoice_lines (business_id, invoice_id, position, name, unit, ordered_quantity, delivered_quantity) values ('${a.businessId}', '${inv.id}', 99, 'X', 'strip', 1, 1)`,
      `update public.invoice_events set detail = '{}' where invoice_id = '${inv.id}'`,
      `delete from public.invoice_events where invoice_id = '${inv.id}'`,
    ];
    for (const sql of attempts) {
      await expect(db.query(sql), sql).rejects.toThrow(/invoice_immutable|append_only/);
    }
    const still = (await dbInvoiceGet(db, a.userId, inv.id)) as Invoice & { found: true };
    expect(still).toMatchObject({ status: "issued", invoice_number: inv.invoice_number, grand_total: "2805.00" });
    expect(still.lines.map((l) => l.delivered_quantity)).toEqual([10, 5]);
  });

  it("cannot be written by a signed-in user directly", async () => {
    const { inv } = await issued();
    for (const sql of [
      `update public.invoices set grand_total = 1 where id = '${inv.id}'`,
      `delete from public.invoices where id = '${inv.id}'`,
      `update public.invoice_lines set delivered_quantity = 1`,
      `delete from public.invoice_events`,
    ]) {
      await expect(withRole(db, "authenticated", a.userId, () => db.query(sql)), sql).rejects.toThrow(/permission denied/i);
    }
  });
});
