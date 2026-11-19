import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvoice, getInvoice, getInvoiceSummary, issueInvoice, listInvoices, listToInvoice } from "@/lib/invoices/repository";
import { InvoiceListQuerySchema, ToInvoiceQuerySchema } from "@/lib/validation/invoice";
import { seedOrderWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-001 and SC-009: the Invoices list of a business with 1,000 invoices opens within 3 seconds, a draft for an order
// with 20 lines is created within 2 seconds and an invoice of 60 lines is issued within 2 seconds. Run against the
// Supabase test project; every request is made as a real signed-in user. The times include the network round trip from
// this machine to the hosted project, but not the Next.js route or the browser. The bulk rows are seeded with the
// service role, in this test only (never in src/). Needs migration 0007 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const LIST_LIMIT_MS = 3_000;
const CREATE_LIMIT_MS = 2_000;
const ISSUE_LIMIT_MS = 2_000;
const RUNS = 5;

suite("invoices at scale", () => {
  let a: TestTenant;
  let storeIds: string[];
  let products: string[];
  const measured: Record<string, number[]> = {};

  /**
   * The goal must hold for the median of the runs. One slow run (network jitter between this machine and the hosted
   * project) is tolerated up to twice the goal. The slowest run is still printed in afterAll.
   */
  function expectWithin(label: string, limit: number): void {
    const runs = [...(measured[label] ?? [])].sort((x, y) => x - y);
    expect(runs.length, `${label}: runs`).toBeGreaterThan(0);
    expect(runs[Math.floor(runs.length / 2)], `${label}: median`).toBeLessThan(limit);
    expect(runs[runs.length - 1], `${label}: slowest run`).toBeLessThan(limit * 2);
  }

  async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await run();
    (measured[label] ??= []).push(Math.round(performance.now() - start));
    return result;
  }

  async function timeRuns<T>(label: string, run: () => Promise<T>): Promise<T> {
    let last!: T;
    for (let i = 0; i < RUNS; i += 1) last = await time(label, run);
    return last;
  }

  async function insertChunks(table: string, rows: Record<string, unknown>[], size = 250) {
    const admin = serviceClient();
    for (let i = 0; i < rows.length; i += size) {
      const res = await admin.from(table).insert(rows.slice(i, i + size));
      if (res.error) throw new Error(`seed ${table}: ${res.error.message}`);
    }
  }

  async function sixtyLineOrder() {
    return seedOrderWithClient(a.client, storeIds[0], products.slice(0, 60).map((product_id, i) => ({ product_id, quantity: 1 + (i % 9), unit: "strip" })), { confirm: true });
  }

  beforeAll(async () => {
    a = await createTenant("invoice-scale");
    const businessId = a.businessId as string;
    const storeRows = Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), name: `Scale Store ${String(i).padStart(2, "0")}` }));
    const storeRes = await a.client.from("stores").insert(storeRows);
    if (storeRes.error) throw new Error(`seed stores: ${storeRes.error.message}`);
    storeIds = storeRows.map((s) => s.id);
    const productRows = Array.from({ length: 150 }, (_, i) => ({ id: randomUUID(), name: `Scale Med ${String(i).padStart(3, "0")}`, unit: "strip", purchase_price: "10.00", selling_price: "15.00" }));
    for (let i = 0; i < productRows.length; i += 75) {
      const res = await a.client.from("products").insert(productRows.slice(i, i + 75));
      if (res.error) throw new Error(`seed medicines: ${res.error.message}`);
    }
    products = productRows.map((p) => p.id);

    const now = Date.now();
    // 1,000 orders and their invoices: 900 issued (order fulfilled), 50 cancelled and 50 drafts (order confirmed).
    const orders = Array.from({ length: 1000 }, (_, i) => {
      const kind = i % 20 === 0 ? "draft" : i % 20 === 1 ? "cancelled" : "issued";
      return { i, kind, id: randomUUID(), store: storeRows[i % 50] };
    });
    await insertChunks(
      "orders",
      orders.map((o) => ({
        id: o.id,
        business_id: businessId,
        store_id: o.store.id,
        order_number: o.i + 1,
        status: o.kind === "issued" ? "fulfilled" : "confirmed",
        confirmed_at: new Date(now - (1000 - o.i) * 60_000).toISOString(),
      })),
    );
    await insertChunks(
      "invoices",
      orders.map((o) => {
        const base = { id: randomUUID(), business_id: businessId, order_id: o.id, store_id: o.store.id, source_fingerprint: "x", grand_total: "1500.00", created_at: new Date(now - (1000 - o.i) * 60_000).toISOString() };
        if (o.kind === "draft") return { ...base, status: "draft" };
        const issued = { ...base, status: "issued", invoice_number: o.i + 1, invoice_date: new Date(now).toISOString().slice(0, 10), issued_at: new Date(now).toISOString(), business_name: "Scale business", store_name: o.store.name };
        return o.kind === "cancelled" ? { ...issued, status: "cancelled", cancelled_at: new Date(now).toISOString(), cancel_reason: "Scale test" } : issued;
      }),
    );

    // The seeded invoices carry the numbers 1 to 1000, so the counter of the business continues after them.
    await insertChunks("invoice_counters", [{ business_id: businessId, last_number: 1000 }]);

    // 200 more confirmed orders of 5 lines each that still wait for an invoice (the "to invoice" list).
    const waiting = Array.from({ length: 200 }, (_, i) => ({ id: randomUUID(), i }));
    await insertChunks(
      "orders",
      waiting.map((o) => ({ id: o.id, business_id: businessId, store_id: storeIds[o.i % 50], order_number: 1001 + o.i, status: "confirmed", confirmed_at: new Date(now - o.i * 1000).toISOString() })),
    );
    await insertChunks(
      "order_lines",
      waiting.flatMap((o) =>
        Array.from({ length: 5 }, (_, j) => ({
          id: randomUUID(),
          business_id: businessId,
          order_id: o.id,
          position: j + 1,
          product_id: products[(o.i * 5 + j) % 150],
          item_status: "registered",
          name: `Scale Med ${String((o.i * 5 + j) % 150).padStart(3, "0")}`,
          quantity: 1 + ((o.i + j) % 9),
          unit: "strip",
          delivered_quantity: 1 + ((o.i + j) % 9),
          selling_price_snapshot: "15.00",
          snapshot_taken_at: new Date(now).toISOString(),
        })),
      ),
    );
  }, 900_000);

  afterAll(async () => {
    console.info(`SC-001 and SC-009 measured times in ms:\n${Object.entries(measured).map(([k, v]) => `  ${k}: ${v.join(", ")} (max ${Math.max(...v)})`).join("\n")}`);
    await deleteTenant(a);
  }, 600_000);

  it("opens the first page of 1,000 invoices within 3 seconds and gives the right total", async () => {
    const page = await timeRuns("invoices list, first page (1,000 invoices)", () => listInvoices(a.client, InvoiceListQuerySchema.parse({})));
    expect(page.total).toBe(1000);
    expect(page.items).toHaveLength(20);
    expectWithin("invoices list, first page (1,000 invoices)", LIST_LIMIT_MS);
  }, 300_000);

  it("opens filtered, searched and later pages within 3 seconds", async () => {
    const issued = await timeRuns("invoices list, status issued", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ status: "issued" })));
    expect(issued.total).toBe(900);
    const byStore = await timeRuns("invoices list, one store", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ store: storeIds[7] })));
    expect(byStore.total).toBe(20);
    const byNumber = await timeRuns("invoices list, by number", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ q: "INV-000500" })));
    expect(byNumber.total).toBe(1);
    const byName = await timeRuns("invoices list, by store name", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ q: "scale store 07" })));
    expect(byName.total).toBe(20);
    await timeRuns("invoices list, page 40", () => listInvoices(a.client, InvoiceListQuerySchema.parse({ offset: "980" })));
    for (const label of ["invoices list, status issued", "invoices list, one store", "invoices list, by number", "invoices list, by store name", "invoices list, page 40"]) {
      expectWithin(label, LIST_LIMIT_MS);
    }
  }, 300_000);

  it("gives the to-invoice list and the summary within 3 seconds, and the count equals the list", async () => {
    const todo = await timeRuns("to-invoice list (250 orders)", () => listToInvoice(a.client, ToInvoiceQuerySchema.parse({})));
    const summary = await timeRuns("invoice summary", () => getInvoiceSummary(a.client));
    // The 200 waiting orders have lines. The 100 seeded orders whose invoice is a draft or was cancelled have no lines,
    // and an order without an active line is never on the list (nothing could be billed).
    expect(todo.total).toBe(200);
    expect(summary.to_invoice).toBe(todo.total);
    expectWithin("to-invoice list (250 orders)", LIST_LIMIT_MS);
    expectWithin("invoice summary", LIST_LIMIT_MS);
  }, 300_000);

  it("creates a draft for a 20-line order within 2 seconds", async () => {
    for (let i = 0; i < RUNS; i += 1) {
      const order = await seedOrderWithClient(a.client, storeIds[1], products.slice(i * 20, i * 20 + 20).map((product_id) => ({ product_id, quantity: 3, unit: "strip" })), { confirm: true });
      const created = await time("create draft (20 lines)", () => createInvoice(a.client, { id: randomUUID(), order_id: order.orderId }));
      expect(created.invoice.lines).toHaveLength(20);
    }
    expectWithin("create draft (20 lines)", CREATE_LIMIT_MS);
  }, 600_000);

  it("issues a 60-line invoice within 2 seconds and reads it back within 3 seconds", async () => {
    let lastId = "";
    for (let i = 0; i < RUNS; i += 1) {
      const order = await sixtyLineOrder();
      const draft = (await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId })).invoice;
      expect(draft.lines).toHaveLength(60);
      const issued = await time("issue invoice (60 lines)", () => issueInvoice(a.client, draft.id, draft.version));
      expect(issued.invoice.status).toBe("issued");
      lastId = draft.id;
    }
    const got = await timeRuns("read invoice (60 lines)", () => getInvoice(a.client, lastId));
    expect(got.lines).toHaveLength(60);
    expectWithin("issue invoice (60 lines)", ISSUE_LIMIT_MS);
    expectWithin("read invoice (60 lines)", LIST_LIMIT_MS);
  }, 600_000);
});
