import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedInvoiceOrder, type InvoiceSeed } from "../helpers/invoices-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Schema, constraints, triggers and privileges of migration 0007 (invoices), on a real PostgreSQL engine (PGlite)
// with a Supabase-like role setup. Rows are inserted as the table owner here, which bypasses Row Level Security,
// so these tests exercise the constraints and triggers themselves.

let db: PGlite;
let a: Tenant;

const INVOICE_TABLES = ["invoice_counters", "invoice_events", "invoice_lines", "invoices"];

const PUBLIC_FUNCTIONS = [
  "invoice_create",
  "invoice_set_quantities",
  "invoice_refresh",
  "invoice_discard",
  "invoice_issue",
  "invoice_cancel",
  "invoice_get",
  "invoice_list",
  "invoice_todo",
  "invoice_summary",
  "invoice_orders_summary",
  "invoice_json",
  "invoice_todo_rows",
  "order_lines_fingerprint",
  "order_sheet",
  "order_sheet_day",
];

const INTERNAL_FUNCTIONS = ["invoice_build_lines", "invoice_recompute_total"];

/** A new confirmed order (its own store and medicines) so every invoice below has an order of its own. */
async function newOrder(): Promise<InvoiceSeed> {
  return seedInvoiceOrder(db, a);
}

async function insertInvoice(seed: InvoiceSeed, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = {
    id,
    business_id: a.businessId,
    order_id: seed.order.id,
    store_id: seed.seeded.storeId,
    status: "draft",
    source_fingerprint: "x",
    ...overrides,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.invoices (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return id;
}

/** The fields an issued or cancelled invoice must carry (the shape check). */
let numberSeq = 0;
function issuedFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  numberSeq += 1;
  return {
    status: "issued",
    invoice_number: numberSeq,
    invoice_date: "2026-11-14",
    issued_at: new Date().toISOString(),
    business_name: "A business",
    store_name: "A store",
    ...overrides,
  };
}

async function insertLine(invoiceId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = {
    id,
    business_id: a.businessId,
    invoice_id: invoiceId,
    position: 1,
    name: "Panadol 500mg",
    unit: "strip",
    ordered_quantity: 10,
    delivered_quantity: 10,
    selling_price: "125.50",
    ...overrides,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.invoice_lines (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return id;
}

async function status(table: string, id: string): Promise<string> {
  const res = await db.query<{ status: string }>(`select status from public.${table} where id = $1`, [id]);
  return res.rows[0].status;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("the four invoice tables", () => {
  it("exist with Row Level Security on and a business_id column", async () => {
    const res = await db.query<{ table_name: string; rls: boolean; has_business: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls,
              exists (select 1 from information_schema.columns k
                       where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'business_id') as has_business
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[]) order by c.relname`,
      [INVOICE_TABLES],
    );
    expect(res.rows.map((r) => r.table_name)).toEqual(INVOICE_TABLES);
    for (const row of res.rows) {
      expect(row.rls, `${row.table_name} must have RLS enabled`).toBe(true);
      expect(row.has_business, `${row.table_name} must have a business_id`).toBe(true);
    }
  });

  it("have no column about a purchase price, MRP, cost, margin or profit (Principle II)", async () => {
    const res = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
          and column_name ~* 'purchase|mrp|cost|margin|profit'`,
      [INVOICE_TABLES],
    );
    expect(res.rows).toEqual([]);
  });

  it("have every public function with execute for signed-in users and none for anon", async () => {
    for (const name of PUBLIC_FUNCTIONS) {
      const res = await db.query<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      expect(res.rows.length, `${name} exists`).toBeGreaterThan(0);
      for (const row of res.rows) {
        expect(row.authenticated, `${name} is executable by signed-in users`).toBe(true);
        expect(row.anon, `${name} is not executable by anon`).toBe(false);
      }
    }
  });

  it("keep the internal write helpers away from signed-in users", async () => {
    for (const name of INTERNAL_FUNCTIONS) {
      const res = await db.query<{ authenticated: boolean; anon: boolean }>(
        `select has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      expect(res.rows.length, `${name} exists`).toBeGreaterThan(0);
      for (const row of res.rows) {
        expect(row.authenticated).toBe(false);
        expect(row.anon).toBe(false);
      }
    }
  });
});

describe("invoice constraints", () => {
  it("accepts a draft and an issued invoice with the required fields", async () => {
    const draft = await insertInvoice(await newOrder());
    expect(await status("invoices", draft)).toBe("draft");
    const issued = await insertInvoice(await newOrder(), issuedFields());
    expect(await status("invoices", issued)).toBe("issued");
  });

  it.each([
    ["a draft that already has a number", { invoice_number: 5 }],
    ["a draft that already has an issue date", { invoice_date: "2026-11-14" }],
    ["a draft with a business name snapshot", { business_name: "x" }],
    ["an unknown status", { status: "paid" }],
    ["a negative grand total", { grand_total: "-1" }],
    ["a cancel reason over 500 characters", { cancel_reason: "x".repeat(501) }],
  ])("refuses %s", async (_label, overrides) => {
    await expect(insertInvoice(await newOrder(), overrides)).rejects.toThrow();
  });

  it.each([
    ["an issued invoice without a number", { invoice_number: null }],
    ["an issued invoice without an invoice date", { invoice_date: null }],
    ["an issued invoice without an issue time", { issued_at: null }],
    ["an issued invoice without a business name", { business_name: null }],
    ["an issued invoice without a store name", { store_name: null }],
    ["an issued invoice that carries a cancellation", { cancelled_at: new Date().toISOString(), cancel_reason: "x" }],
    ["a number of 0", { invoice_number: 0 }],
  ])("refuses %s", async (_label, overrides) => {
    await expect(insertInvoice(await newOrder(), issuedFields(overrides))).rejects.toThrow();
  });

  it("refuses a cancelled invoice without a reason or a time, and accepts one with both", async () => {
    await expect(insertInvoice(await newOrder(), issuedFields({ status: "cancelled" }))).rejects.toThrow();
    await expect(
      insertInvoice(await newOrder(), issuedFields({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "   " })),
    ).rejects.toThrow();
    const ok = await insertInvoice(
      await newOrder(),
      issuedFields({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Wrong store" }),
    );
    expect(await status("invoices", ok)).toBe("cancelled");
  });

  it("refuses a second invoice number equal to an existing one in the same business", async () => {
    const n = 9001;
    await insertInvoice(await newOrder(), issuedFields({ invoice_number: n }));
    await expect(insertInvoice(await newOrder(), issuedFields({ invoice_number: n }))).rejects.toThrow();
  });

  it("allows the same invoice number in two businesses (numbers are counted per business)", async () => {
    const b = await createTenant(db, "b-number");
    const other = await seedInvoiceOrder(db, b);
    const n = 9100;
    await insertInvoice(await newOrder(), issuedFields({ invoice_number: n }));
    const id = randomUUID();
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint, invoice_number, invoice_date, issued_at, business_name, store_name)
       values ($1, $2, $3, $4, 'issued', 'x', $5, '2026-11-14', now(), 'B', 'S')`,
      [id, b.businessId, other.order.id, other.seeded.storeId, n],
    );
    expect(await status("invoices", id)).toBe("issued");
  });

  it("allows only one live invoice per order, and a new one after a cancellation", async () => {
    const seed = await newOrder();
    const first = await insertInvoice(seed);
    await expect(insertInvoice(seed)).rejects.toThrow();
    // An issued invoice is live too.
    await db.query(
      `update public.invoices set status = 'issued', invoice_number = 9200, invoice_date = '2026-11-14', issued_at = now(),
              business_name = 'A', store_name = 'S' where id = $1`,
      [first],
    );
    await expect(insertInvoice(seed)).rejects.toThrow();
    await db.query(
      `update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Wrong store' where id = $1`,
      [first],
    );
    const second = await insertInvoice(seed);
    expect(await status("invoices", second)).toBe("draft");
  });

  it("refuses an order or a store of another business (composite foreign keys)", async () => {
    const b = await createTenant(db, "b-fk");
    const other = await seedInvoiceOrder(db, b);
    await expect(insertInvoice(other)).rejects.toThrow();
  });
});

describe("invoice line constraints", () => {
  it("accepts a delivered quantity of 0 and generates the line total", async () => {
    const inv = await insertInvoice(await newOrder());
    const zero = await insertLine(inv, { position: 1, delivered_quantity: 0 });
    const eight = await insertLine(inv, { position: 2, delivered_quantity: 8, selling_price: "125.50" });
    const noPrice = await insertLine(inv, { position: 3, delivered_quantity: 4, selling_price: null });
    const totals = await db.query<{ id: string; line_total: string | null }>(
      `select id, line_total::text as line_total from public.invoice_lines where invoice_id = $1`,
      [inv],
    );
    const by = Object.fromEntries(totals.rows.map((r) => [r.id, r.line_total]));
    expect(by[zero]).toBe("0.00");
    expect(by[eight]).toBe("1004.00");
    expect(by[noPrice]).toBeNull();
  });

  it.each([
    ["a delivered quantity of -1", { delivered_quantity: -1 }],
    ["a delivered quantity of 100001", { delivered_quantity: 100001 }],
    ["an ordered quantity of 0", { ordered_quantity: 0 }],
    ["a negative selling price", { selling_price: "-0.01" }],
    ["an empty name", { name: "   " }],
    ["a position of 0", { position: 0 }],
  ])("refuses %s", async (_label, overrides) => {
    const inv = await insertInvoice(await newOrder());
    await expect(insertLine(inv, overrides)).rejects.toThrow();
  });

  it("refuses a second line at the same position and a medicine of another business", async () => {
    const inv = await insertInvoice(await newOrder());
    await insertLine(inv, { position: 1 });
    await expect(insertLine(inv, { position: 1 })).rejects.toThrow();
    const b = await createTenant(db, "b-line");
    const other = await seedInvoiceOrder(db, b);
    await expect(insertLine(inv, { position: 2, product_id: other.seeded.pricedId })).rejects.toThrow();
  });
});

describe("privileges", () => {
  it("lets a signed-in user read only their own invoices and refuses every direct write", async () => {
    const seed = await newOrder();
    const id = await insertInvoice(seed);
    await insertLine(id);
    const b = await createTenant(db, "b-priv");

    const own = await withRole(db, "authenticated", a.userId, async () => (await db.query(`select id from public.invoices where id = $1`, [id])).rows);
    expect(own).toHaveLength(1);
    const foreign = await withRole(db, "authenticated", b.userId, async () => (await db.query(`select id from public.invoices where id = $1`, [id])).rows);
    expect(foreign).toHaveLength(0);

    for (const sql of [
      `insert into public.invoices (id, order_id, store_id, source_fingerprint) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x')`,
      `update public.invoices set grand_total = 1`,
      `delete from public.invoices`,
      `insert into public.invoice_lines (invoice_id, position, name, unit, ordered_quantity, delivered_quantity) values (gen_random_uuid(), 1, 'x', 'strip', 1, 1)`,
      `update public.invoice_lines set delivered_quantity = 1`,
      `delete from public.invoice_lines`,
      `insert into public.invoice_events (invoice_id, order_id, event_type, invoice_version) values (gen_random_uuid(), gen_random_uuid(), 'created', 1)`,
      `select * from public.invoice_counters`,
      `insert into public.invoice_counters (business_id, last_number) values (gen_random_uuid(), 99)`,
    ]) {
      await expect(withRole(db, "authenticated", a.userId, () => db.query(sql)), sql).rejects.toThrow(/permission denied/i);
    }
  });

  it("gives anon no access at all", async () => {
    for (const table of INVOICE_TABLES) {
      await expect(withRole(db, "anon", null, () => db.query(`select 1 from public.${table}`)), table).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("guard triggers", () => {
  it("lets a draft change freely, but never its order, store or identity", async () => {
    const seed = await newOrder();
    const id = await insertInvoice(seed);
    await db.query(`update public.invoices set grand_total = 10, source_fingerprint = 'y' where id = $1`, [id]);
    const other = await newOrder();
    await expect(db.query(`update public.invoices set order_id = $2 where id = $1`, [id, other.order.id])).rejects.toThrow(/invoice_immutable/);
    await expect(db.query(`update public.invoices set store_id = $2 where id = $1`, [id, other.seeded.storeId])).rejects.toThrow(/invoice_immutable/);
    await expect(db.query(`update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'x' where id = $1`, [id])).rejects.toThrow();
  });

  it("lets an issued invoice become cancelled with the cancellation fields and nothing else", async () => {
    const id = await insertInvoice(await newOrder(), issuedFields({ grand_total: "500.00" }));
    for (const change of [
      `grand_total = 1`,
      `invoice_number = 777777`,
      `invoice_date = '2020-01-01'`,
      `business_name = 'Changed'`,
      `store_name = 'Changed'`,
      `source_fingerprint = 'changed'`,
      `status = 'draft'`,
    ]) {
      await expect(db.query(`update public.invoices set ${change} where id = $1`, [id]), change).rejects.toThrow();
    }
    // Staying issued with a different cancellation field is refused too.
    await expect(db.query(`update public.invoices set cancel_reason = 'x' where id = $1`, [id])).rejects.toThrow();
    // Cancelling and changing the total together is refused.
    await expect(
      db.query(`update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'x', grand_total = 1 where id = $1`, [id]),
    ).rejects.toThrow(/invoice_immutable/);
    await db.query(`update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Wrong store' where id = $1`, [id]);
    expect(await status("invoices", id)).toBe("cancelled");
    // A cancelled invoice never changes again.
    await expect(db.query(`update public.invoices set cancel_reason = 'Other' where id = $1`, [id])).rejects.toThrow(/invoice_immutable/);
    await expect(db.query(`update public.invoices set status = 'issued' where id = $1`, [id])).rejects.toThrow(/invoice_immutable/);
  });

  it("deletes a draft but refuses to delete an issued or cancelled invoice", async () => {
    const draft = await insertInvoice(await newOrder());
    await db.query(`delete from public.invoices where id = $1`, [draft]);
    const issued = await insertInvoice(await newOrder(), issuedFields());
    await expect(db.query(`delete from public.invoices where id = $1`, [issued])).rejects.toThrow(/invoice_immutable/);
    const cancelled = await insertInvoice(
      await newOrder(),
      issuedFields({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Wrong store" }),
    );
    await expect(db.query(`delete from public.invoices where id = $1`, [cancelled])).rejects.toThrow(/invoice_immutable/);
  });

  it("lets the lines of a draft change, and refuses every change once the invoice is issued", async () => {
    const id = await insertInvoice(await newOrder());
    const line = await insertLine(id, { position: 1 });
    await db.query(`update public.invoice_lines set delivered_quantity = 5 where id = $1`, [line]);
    await insertLine(id, { position: 2 });
    await db.query(
      `update public.invoices set status = 'issued', invoice_number = 9300, invoice_date = '2026-11-14', issued_at = now(),
              business_name = 'A', store_name = 'S' where id = $1`,
      [id],
    );
    await expect(db.query(`update public.invoice_lines set delivered_quantity = 6 where id = $1`, [line])).rejects.toThrow(/invoice_immutable/);
    await expect(db.query(`update public.invoice_lines set selling_price = 1 where id = $1`, [line])).rejects.toThrow(/invoice_immutable/);
    await expect(db.query(`delete from public.invoice_lines where id = $1`, [line])).rejects.toThrow(/invoice_immutable/);
    await expect(insertLine(id, { position: 3 })).rejects.toThrow(/invoice_immutable/);
    // The identity of a draft's line never changes either.
    const draft = await insertInvoice(await newOrder());
    const dl = await insertLine(draft);
    await expect(db.query(`update public.invoice_lines set invoice_id = $2 where id = $1`, [dl, id])).rejects.toThrow();
  });

  it("makes the invoice history append-only", async () => {
    const id = randomUUID();
    const seed = await newOrder();
    await db.query(
      `insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version) values ($1, $2, $3, 'created', 1)`,
      [a.businessId, id, seed.order.id],
    );
    await expect(db.query(`update public.invoice_events set event_type = 'edited' where invoice_id = $1`, [id])).rejects.toThrow(/append_only/);
    await expect(db.query(`delete from public.invoice_events where invoice_id = $1`, [id])).rejects.toThrow(/append_only/);
    await expect(
      db.query(`insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version) values ($1, $2, $3, 'bogus', 1)`, [a.businessId, id, seed.order.id]),
    ).rejects.toThrow();
  });
});

describe("changes to Module 003 objects", () => {
  it("lets an order go confirmed -> fulfilled -> confirmed, and refuses every other new status change", async () => {
    const seed = await newOrder();
    const id = seed.order.id;
    await db.query(`update public.orders set status = 'fulfilled' where id = $1`, [id]);
    expect(await status("orders", id)).toBe("fulfilled");
    // A fulfilled order cannot be cancelled directly, only returned to confirmed.
    await expect(db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'x' where id = $1`, [id])).rejects.toThrow(/invalid status change/);
    await expect(db.query(`update public.orders set status = 'draft' where id = $1`, [id])).rejects.toThrow(/invalid status change/);
    await db.query(`update public.orders set status = 'confirmed' where id = $1`, [id]);
    expect(await status("orders", id)).toBe("confirmed");

    // A draft cannot jump to fulfilled.
    const draft = await seedInvoiceOrder(db, a, { confirm: false });
    await expect(db.query(`update public.orders set status = 'fulfilled' where id = $1`, [draft.order.id])).rejects.toThrow(/invalid status change/);

    // A cancelled order never comes back.
    const toCancel = await newOrder();
    await db.query(`update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Test' where id = $1`, [toCancel.order.id]);
    await expect(db.query(`update public.orders set status = 'confirmed' where id = $1`, [toCancel.order.id])).rejects.toThrow(/invalid status change/);
    await expect(db.query(`update public.orders set status = 'fulfilled' where id = $1`, [toCancel.order.id])).rejects.toThrow(/invalid status change/);
  });

  it("accepts the two new order event kinds and still refuses an unknown one", async () => {
    const seed = await newOrder();
    for (const kind of ["invoiced", "invoice_cancelled", "linked", "price_filled"]) {
      await db.query(
        `insert into public.order_events (business_id, order_id, event_type, order_version) values ($1, $2, $3, 1)`,
        [a.businessId, seed.order.id, kind],
      );
    }
    await expect(
      db.query(`insert into public.order_events (business_id, order_id, event_type, order_version) values ($1, $2, 'bogus', 1)`, [a.businessId, seed.order.id]),
    ).rejects.toThrow();
  });

  it("accepts a delivered quantity of 0 on an order line and still refuses a negative one", async () => {
    const seed = await newOrder();
    const lineId = seed.order.lineIds[0];
    await db.query(`update public.order_lines set delivered_quantity = 0 where id = $1`, [lineId]);
    const res = await db.query<{ delivered_quantity: number }>(`select delivered_quantity from public.order_lines where id = $1`, [lineId]);
    expect(res.rows[0].delivered_quantity).toBe(0);
    await expect(db.query(`update public.order_lines set delivered_quantity = -1 where id = $1`, [lineId])).rejects.toThrow();
  });
});
