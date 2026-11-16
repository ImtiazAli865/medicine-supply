import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedInvoiceOrder, insertStore, type InvoiceSeed } from "../helpers/invoices-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";

// Schema, constraints, triggers and privileges of migration 0008 (the store ledger), on a real PostgreSQL engine
// (PGlite) with a Supabase-like role setup. Rows are inserted as the table owner here, which bypasses Row Level
// Security, so these tests exercise the constraints and triggers themselves.

let db: PGlite;
let a: Tenant;
let storeA: string;
let storeB: string;

const FORBIDDEN_COLUMN = /purchase|mrp|cost|margin|profit/i;

async function insertEntry(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = {
    id,
    business_id: a.businessId,
    store_id: storeA,
    entry_type: "opening_balance",
    entry_date: "2026-11-01",
    debit: "100.00",
    credit: "0",
    ...overrides,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.ledger_entries (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return String(row.id);
}

let numberSeq = 0;

/** An issued invoice that is in the account (inserted directly as the table owner), for the invoice-entry checks. */
async function insertIssuedInvoice(seed: InvoiceSeed, overrides: Record<string, unknown> = {}): Promise<string> {
  numberSeq += 1;
  const id = randomUUID();
  const row: Record<string, unknown> = {
    id,
    business_id: a.businessId,
    order_id: seed.order.id,
    store_id: seed.seeded.storeId,
    status: "issued",
    invoice_number: 9000 + numberSeq,
    invoice_date: "2026-11-14",
    issued_at: new Date().toISOString(),
    business_name: "A business",
    store_name: "A store",
    source_fingerprint: "x",
    grand_total: "500.00",
    in_account: true,
    summary_previous: "0.00",
    summary_due: "500.00",
    ...overrides,
  };
  const cols = Object.keys(row);
  await db.query(
    `insert into public.invoices (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c]),
  );
  return id;
}

async function expectRefused(promise: Promise<unknown>, pattern?: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "ledger-schema");
  storeA = await insertStore(db, a.businessId, "Store A");
  storeB = await insertStore(db, a.businessId, "Store B");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("table and columns", () => {
  it("has Row Level Security on and a business_id column", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.ledger_entries'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const col = await db.query(
      `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ledger_entries' and column_name = 'business_id'`,
    );
    expect(col.rows.length).toBe(1);
  });

  it("has no purchase price, MRP, cost, margin or profit column (ledger table or the new invoice columns)", async () => {
    const res = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('ledger_entries', 'invoices')`,
    );
    const bad = res.rows.filter((r) => FORBIDDEN_COLUMN.test(r.column_name));
    expect(bad).toEqual([]);
  });

  it("adds the four account columns to invoices with in_account false by default", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const id = randomUUID();
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint) values ($1, $2, $3, $4, 'draft', 'x')`,
      [id, a.businessId, seed.order.id, seed.seeded.storeId],
    );
    const res = await db.query<{ in_account: boolean; summary_previous: string | null; summary_payment: string | null; summary_due: string | null }>(
      `select in_account, summary_previous, summary_payment, summary_due from public.invoices where id = $1`,
      [id],
    );
    expect(res.rows[0]).toEqual({ in_account: false, summary_previous: null, summary_payment: null, summary_due: null });
  });
});

describe("check constraints", () => {
  it("allows exactly one side: both zero and both above zero are refused", async () => {
    await expectRefused(insertEntry({ debit: "0", credit: "0" }));
    await expectRefused(insertEntry({ debit: "10.00", credit: "10.00" }));
    await expectRefused(insertEntry({ debit: "-5.00", credit: "0" }));
    await insertEntry({ debit: "0", credit: "25.00" });
  });

  it("refuses an entry date before 2000-01-01", async () => {
    await expectRefused(insertEntry({ entry_date: "1999-12-31" }));
  });

  it("gives each entry type its shape", async () => {
    // payment: a credit with a method
    await expectRefused(insertEntry({ entry_type: "payment", debit: "0", credit: "50.00" }));
    await expectRefused(insertEntry({ entry_type: "payment", debit: "50.00", credit: "0", payment_method: "cash" }));
    await insertEntry({ entry_type: "payment", debit: "0", credit: "50.00", payment_method: "cash" });
    // an unknown method is refused, the later methods are allowed by the table
    await expectRefused(insertEntry({ entry_type: "payment", debit: "0", credit: "50.00", payment_method: "cheque" }));
    await insertEntry({ entry_type: "payment", debit: "0", credit: "50.00", payment_method: "bank_transfer" });
    // adjustment: a reason is required
    await expectRefused(insertEntry({ entry_type: "adjustment", debit: "0", credit: "5.00" }));
    await expectRefused(insertEntry({ entry_type: "adjustment", debit: "0", credit: "5.00", note: "   " }));
    await insertEntry({ entry_type: "adjustment", debit: "0", credit: "5.00", note: "Small amount forgiven" });
    // opening balance: no invoice, no method, no reversal target
    await expectRefused(insertEntry({ entry_type: "opening_balance", payment_method: "cash" }));
    // only a payment may carry a reference
    await expectRefused(insertEntry({ entry_type: "opening_balance", reference: "R-1" }));
    await insertEntry({ entry_type: "payment", debit: "0", credit: "10.00", payment_method: "cash", reference: "R-1" });
    // reversal: needs a target and a reason
    await expectRefused(insertEntry({ entry_type: "reversal", debit: "0", credit: "10.00", note: "x" }));
    // a reason longer than 500 characters is refused
    await expectRefused(insertEntry({ entry_type: "adjustment", debit: "0", credit: "5.00", note: "x".repeat(501) }));
  });
});

describe("exactly-once indexes", () => {
  it("allows one invoice entry per invoice", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const invoice = await insertIssuedInvoice(seed);
    await insertEntry({ store_id: seed.seeded.storeId, entry_type: "invoice", debit: "500.00", invoice_id: invoice });
    await expectRefused(insertEntry({ store_id: seed.seeded.storeId, entry_type: "invoice", debit: "500.00", invoice_id: invoice }), /duplicate|unique/i);
  });

  it("allows one reversal per entry", async () => {
    const original = await insertEntry({ entry_type: "payment", debit: "0", credit: "40.00", payment_method: "cash" });
    await insertEntry({ entry_type: "reversal", debit: "40.00", credit: "0", reverses_entry_id: original, note: "Wrong store" });
    await expectRefused(
      insertEntry({ entry_type: "reversal", debit: "40.00", credit: "0", reverses_entry_id: original, note: "Again" }),
      /duplicate|unique/i,
    );
  });

  it("allows one payment received with an invoice", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const invoice = await insertIssuedInvoice(seed);
    const store = seed.seeded.storeId;
    await insertEntry({ store_id: store, entry_type: "payment", debit: "0", credit: "100.00", payment_method: "cash", invoice_id: invoice });
    await expectRefused(
      insertEntry({ store_id: store, entry_type: "payment", debit: "0", credit: "50.00", payment_method: "cash", invoice_id: invoice }),
      /duplicate|unique/i,
    );
    // payments that are not linked to an invoice are not limited
    await insertEntry({ store_id: store, entry_type: "payment", debit: "0", credit: "5.00", payment_method: "cash" });
    await insertEntry({ store_id: store, entry_type: "payment", debit: "0", credit: "5.00", payment_method: "cash" });
  });
});

describe("the store can never be wrong (composite foreign keys)", () => {
  it("refuses an entry that points at an invoice of another store", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const invoice = await insertIssuedInvoice(seed);
    await expectRefused(
      insertEntry({ store_id: storeB, entry_type: "payment", debit: "0", credit: "10.00", payment_method: "cash", invoice_id: invoice }),
      /foreign key|violates|ledger_invalid/i,
    );
  });

  it("refuses a reversal that points at an entry of another store", async () => {
    const original = await insertEntry({ store_id: storeA, entry_type: "payment", debit: "0", credit: "40.00", payment_method: "cash" });
    await expectRefused(
      insertEntry({ store_id: storeB, entry_type: "reversal", debit: "40.00", credit: "0", reverses_entry_id: original, note: "Other store" }),
      /foreign key|violates|ledger_invalid/i,
    );
  });
});

describe("the invoice account shape", () => {
  it("never allows a draft to be in the account", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await expectRefused(
      db.query(
        `insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint, in_account, summary_previous, summary_due)
         values ($1, $2, $3, $4, 'draft', 'x', true, 0, 0)`,
        [randomUUID(), a.businessId, seed.order.id, seed.seeded.storeId],
      ),
    );
  });

  it("needs the previous balance and the balance due when an issued invoice is in the account", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await expectRefused(insertIssuedInvoice(seed, { summary_previous: null }));
    await expectRefused(insertIssuedInvoice(seed, { summary_due: null }));
  });

  it("allows no figures when the invoice is not in the account, and refuses figures without it", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await insertIssuedInvoice(seed, { in_account: false, summary_previous: null, summary_due: null });
    const seed2 = await seedInvoiceOrder(db, a);
    await expectRefused(insertIssuedInvoice(seed2, { in_account: false }));
  });

  it("refuses a payment received of 0 or less", async () => {
    const seed = await seedInvoiceOrder(db, a);
    await expectRefused(insertIssuedInvoice(seed, { summary_payment: "0" }));
  });
});

describe("privileges", () => {
  it("lets a signed-in user select only and gives anon nothing", async () => {
    await withRole(db, "authenticated", a.userId, async () => {
      await db.query(`select count(*) from public.ledger_entries`);
      await expectRefused(
        db.query(`insert into public.ledger_entries (id, store_id, entry_type, entry_date, debit) values ($1, $2, 'opening_balance', '2026-11-01', 5)`, [randomUUID(), storeA]),
        /permission denied/i,
      );
      await expectRefused(db.query(`update public.ledger_entries set note = 'x'`), /permission denied/i);
      await expectRefused(db.query(`delete from public.ledger_entries`), /permission denied/i);
    });
    await withRole(db, "anon", null, async () => {
      await expectRefused(db.query(`select count(*) from public.ledger_entries`), /permission denied/i);
    });
  });

  it("does not let a signed-in user or anon call the internal insert function", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await withRole(db, role, role === "anon" ? null : a.userId, async () => {
        await expectRefused(
          db.query(
            `select public.ledger_insert_entry($1::uuid, $2::uuid, $3::uuid, 'opening_balance', '2026-11-01'::date, 5, 0, null, null, null, null, null)`,
            [a.businessId, storeA, randomUUID()],
          ),
          /permission denied/i,
        );
      });
    }
  });
});

describe("triggers", () => {
  it("refuses every update and every delete, except a delete by the service role", async () => {
    const id = await insertEntry();
    await expectRefused(db.query(`update public.ledger_entries set note = 'edited' where id = $1`, [id]), /ledger_immutable/);
    await expectRefused(db.query(`update public.ledger_entries set debit = 1 where id = $1`, [id]), /ledger_immutable/);
    await expectRefused(db.query(`delete from public.ledger_entries where id = $1`, [id]), /ledger_immutable/);
    // The Supabase service role owns all privileges on public tables; the test roles start without them.
    await db.exec(`grant all on public.ledger_entries to service_role`);
    await db.exec(`set role service_role`);
    try {
      await db.query(`delete from public.ledger_entries where id = $1`, [id]);
    } finally {
      await db.exec(`reset role`);
    }
    const left = await db.query(`select 1 from public.ledger_entries where id = $1`, [id]);
    expect(left.rows.length).toBe(0);
  });

  it("refuses a reversal that is not the opposite side with the same amount", async () => {
    const payment = await insertEntry({ entry_type: "payment", debit: "0", credit: "40.00", payment_method: "cash" });
    // the same side
    await expectRefused(
      insertEntry({ entry_type: "reversal", debit: "0", credit: "40.00", reverses_entry_id: payment, note: "Same side" }),
      /ledger_invalid/,
    );
    // another amount
    await expectRefused(
      insertEntry({ entry_type: "reversal", debit: "39.00", credit: "0", reverses_entry_id: payment, note: "Other amount" }),
      /ledger_invalid/,
    );
    await insertEntry({ entry_type: "reversal", debit: "40.00", credit: "0", reverses_entry_id: payment, note: "Right" });
  });

  it("refuses a reversal of a reversal", async () => {
    const payment = await insertEntry({ entry_type: "payment", debit: "0", credit: "30.00", payment_method: "cash" });
    const reversal = await insertEntry({ entry_type: "reversal", debit: "30.00", credit: "0", reverses_entry_id: payment, note: "Undo" });
    await expectRefused(
      insertEntry({ entry_type: "reversal", debit: "0", credit: "30.00", reverses_entry_id: reversal, note: "Undo the undo" }),
      /ledger_invalid/,
    );
  });

  it("refuses an invoice entry for a draft and for an invoice that is not in the account", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = randomUUID();
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint) values ($1, $2, $3, $4, 'draft', 'x')`,
      [draft, a.businessId, seed.order.id, seed.seeded.storeId],
    );
    await expectRefused(
      insertEntry({ store_id: seed.seeded.storeId, entry_type: "invoice", debit: "10.00", invoice_id: draft }),
      /ledger_invalid/,
    );
    const seed2 = await seedInvoiceOrder(db, a);
    const legacy = await insertIssuedInvoice(seed2, { in_account: false, summary_previous: null, summary_due: null });
    await expectRefused(
      insertEntry({ store_id: seed2.seeded.storeId, entry_type: "invoice", debit: "10.00", invoice_id: legacy }),
      /ledger_invalid/,
    );
  });

  it("refuses a payment received with a draft invoice", async () => {
    const seed = await seedInvoiceOrder(db, a);
    const draft = randomUUID();
    await db.query(
      `insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint) values ($1, $2, $3, $4, 'draft', 'x')`,
      [draft, a.businessId, seed.order.id, seed.seeded.storeId],
    );
    await expectRefused(
      insertEntry({ store_id: seed.seeded.storeId, entry_type: "payment", debit: "0", credit: "10.00", payment_method: "cash", invoice_id: draft }),
      /ledger_invalid/,
    );
  });
});
