import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInvoiceDraft,
  dbInvoiceCancel,
  dbInvoiceCreate,
  dbInvoiceDiscard,
  dbInvoiceGet,
  dbInvoiceIssue,
  dbInvoiceList,
  dbInvoiceRefresh,
  dbInvoiceSetQuantities,
  dbInvoiceSummary,
  dbInvoiceTodo,
  dbInvoicesOfOrder,
  dbOrderSheet,
  issueInvoice,
  seedInvoiceOrder,
  type InvoiceSeed,
} from "../helpers/invoices-db";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import type { Invoice } from "../../src/lib/invoices/types";

// Business isolation for every Module 006 function on PGlite: business B can never see or change business A's
// invoices, orders or counters, even with crafted ids, and a refusal looks exactly like a missing record.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seed: InvoiceSeed;
let draft: Invoice;
let issued: Invoice;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "a");
  b = await createTenant(db, "b");
  seed = await seedInvoiceOrder(db, a);
  draft = await createInvoiceDraft(db, a.userId, seed.order.id);
  const other = await seedInvoiceOrder(db, a);
  issued = await issueInvoice(db, a.userId, await createInvoiceDraft(db, a.userId, other.order.id));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("every function treats another business's records like missing ones", () => {
  it("reads: get, list, to-invoice, summary, order invoices and order sheets", async () => {
    for (const id of [draft.id, issued.id]) {
      expect(await dbInvoiceGet(db, b.userId, id)).toEqual({ found: false });
    }
    expect(await dbInvoiceGet(db, b.userId, randomUUID())).toEqual({ found: false });
    expect(await dbInvoiceList(db, b.userId)).toEqual({ items: [], total: 0 });
    expect(await dbInvoiceList(db, b.userId, { order: seed.order.id, store: seed.seeded.storeId })).toEqual({ items: [], total: 0 });
    expect(await dbInvoiceTodo(db, b.userId)).toEqual({ items: [], total: 0 });
    expect(await dbInvoiceSummary(db, b.userId)).toEqual({ to_invoice: 0, drafts: 0, issued_today: 0 });
    expect(await dbInvoicesOfOrder(db, b.userId, seed.order.id)).toEqual([]);
    expect((await dbOrderSheet(db, b.userId, [seed.order.id])).sections).toEqual([]);
  });

  it("writes: create, set quantities, refresh, discard, issue and cancel answer exactly like a missing id and change nothing", async () => {
    const missing = randomUUID();
    const counterBefore = await db.query(`select business_id, last_number from public.invoice_counters order by business_id`);
    const checks: Array<[string, unknown, unknown]> = [
      ["create", await dbInvoiceCreate(db, b.userId, seed.order.id), await dbInvoiceCreate(db, b.userId, missing)],
      [
        "set quantities",
        await dbInvoiceSetQuantities(db, b.userId, draft.id, draft.version, [{ line_id: draft.lines[0].id, delivered_quantity: 1 }]),
        await dbInvoiceSetQuantities(db, b.userId, missing, 1, [{ line_id: draft.lines[0].id, delivered_quantity: 1 }]),
      ],
      ["refresh", await dbInvoiceRefresh(db, b.userId, draft.id, draft.version), await dbInvoiceRefresh(db, b.userId, missing, 1)],
      ["discard", await dbInvoiceDiscard(db, b.userId, draft.id, draft.version), await dbInvoiceDiscard(db, b.userId, missing, 1)],
      ["issue", await dbInvoiceIssue(db, b.userId, draft.id, draft.version), await dbInvoiceIssue(db, b.userId, missing, 1)],
      ["cancel", await dbInvoiceCancel(db, b.userId, issued.id, "x"), await dbInvoiceCancel(db, b.userId, missing, "x")],
    ];
    for (const [name, foreign, absent] of checks) {
      expect(foreign, name).toEqual(absent);
      expect(foreign, name).toEqual({ done: false, reason: "not_found" });
    }
    // Nothing of A's changed and no number was used by B.
    expect(await dbInvoiceGet(db, a.userId, draft.id)).toMatchObject({ found: true, status: "draft", version: draft.version });
    expect(await dbInvoiceGet(db, a.userId, issued.id)).toMatchObject({ found: true, status: "issued" });
    expect((await db.query(`select business_id, last_number from public.invoice_counters order by business_id`)).rows).toEqual(counterBefore.rows);
  });

  it("the same invoice id used by two businesses stays separate", async () => {
    const mine = await seedInvoiceOrder(db, a);
    const theirs = await seedInvoiceOrder(db, b);
    const id = randomUUID();
    await dbInvoiceCreate(db, a.userId, mine.order.id, id);
    const second = await dbInvoiceCreate(db, b.userId, theirs.order.id, id);
    expect(second).toMatchObject({ done: true, created: true });
    expect(second.invoice!.order_id).toBe(theirs.order.id);
  });

  it("each business counts its own invoice numbers", async () => {
    const theirs = await seedInvoiceOrder(db, b);
    const first = await issueInvoice(db, b.userId, await createInvoiceDraft(db, b.userId, theirs.order.id));
    expect(first.invoice_number).toBe(1);
    expect(issued.invoice_number).toBe(1);
  });
});

describe("internal helpers and tables", () => {
  it("return nothing when called directly with another business's id", async () => {
    const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);
    const json = await asB(async () => (await db.query<{ r: unknown }>(`select public.invoice_json($1, $2, true) as r`, [a.businessId, issued.id])).rows[0].r);
    expect(json).toBeNull();
    const fingerprint = await asB(async () => (await db.query<{ r: string }>(`select public.order_lines_fingerprint($1, $2) as r`, [a.businessId, seed.order.id])).rows[0].r);
    const empty = (await db.query<{ r: string }>(`select md5('') as r`)).rows[0].r;
    expect(fingerprint).toBe(empty);
    // Business B has orders of its own from the tests above; none of A's may appear.
    const rows = await asB(async () => (await db.query<{ order_id: string }>(`select order_id from public.invoice_todo_rows()`)).rows);
    const mine = await db.query<{ id: string }>(`select id from public.orders where business_id = $1`, [a.businessId]);
    const theirs = new Set(mine.rows.map((r) => r.id));
    expect(rows.some((r) => theirs.has(r.order_id))).toBe(false);
  });

  it("show a signed-in user only their own table rows and refuse direct writes and counter access", async () => {
    const asB = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", b.userId, fn);
    for (const table of ["invoices", "invoice_lines", "invoice_events"]) {
      const rows = await asB(async () => (await db.query<{ business_id: string }>(`select business_id from public.${table}`)).rows);
      expect(rows.every((r) => r.business_id === b.businessId), table).toBe(true);
    }
    for (const sql of [
      `update public.invoices set grand_total = 0`,
      `delete from public.invoices`,
      `select * from public.invoice_counters`,
      `update public.invoice_counters set last_number = 0`,
      `select public.invoice_recompute_total('${a.businessId}', '${draft.id}')`,
      `select public.invoice_build_lines('${a.businessId}', '${draft.id}', '${seed.order.id}')`,
    ]) {
      await expect(asB(() => db.query(sql)), sql).rejects.toThrow(/permission denied/i);
    }
  });

  it("give anon no access to any function or table", async () => {
    for (const sql of [`select public.invoice_get('${draft.id}')`, `select public.invoice_summary()`, `select * from public.invoices`]) {
      await expect(withRole(db, "anon", null, () => db.query(sql)), sql).rejects.toThrow(/permission denied/i);
    }
  });
});
