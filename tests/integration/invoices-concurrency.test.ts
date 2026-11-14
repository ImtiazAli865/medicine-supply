import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelInvoice, createInvoice, issueInvoice } from "@/lib/invoices/repository";
import { seedCatalogWithClient, seedConfirmedOrderOn, type ClientCatalog } from "../helpers/invoices";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Simultaneous requests through separate connections to the real Supabase test project: this is where the unique
// live invoice, the invoice id as the request id, the number counter and the single cancellation are proven, not
// only on one in-memory connection. Needs migration 0007 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("invoices under simultaneous requests", () => {
  let a: TestTenant;
  let catalog: ClientCatalog;

  const invoiceRows = async (orderId: string) => (await a.client.from("invoices").select("id, status, invoice_number").eq("order_id", orderId)).data ?? [];
  const draftFor = async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const { invoice } = await createInvoice(a.client, { id: randomUUID(), order_id: order.orderId });
    return { order, invoice };
  };

  beforeAll(async () => {
    a = await createTenant("invoice-conc");
    catalog = await seedCatalogWithClient(a.client);
  }, 120_000);

  afterAll(async () => {
    await deleteTenant(a);
  });

  it("gives 10 simultaneous identical create requests exactly one draft", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => createInvoice(a.client, { id, order_id: order.orderId })));
    expect(results.filter((r) => r.created === true)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.invoice.id)).size).toBe(1);
    expect(await invoiceRows(order.orderId)).toHaveLength(1);
  }, 120_000);

  it("gives 10 simultaneous create requests with different ids for one order exactly one live invoice", async () => {
    const order = await seedConfirmedOrderOn(a.client, catalog);
    const results = await Promise.all(Array.from({ length: 10 }, () => createInvoice(a.client, { id: randomUUID(), order_id: order.orderId })));
    expect(results.filter((r) => r.created === true)).toHaveLength(1);
    expect(results.filter((r) => r.existing === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.invoice.id)).size).toBe(1);
    expect(await invoiceRows(order.orderId)).toHaveLength(1);
  }, 120_000);

  it("gives 10 simultaneous issues of one draft exactly one number", async () => {
    const { invoice } = await draftFor();
    const results = await Promise.all(Array.from({ length: 10 }, () => issueInvoice(a.client, invoice.id, invoice.version)));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.invoice.invoice_number)).size).toBe(1);
    expect(results.every((r) => r.invoice.status === "issued")).toBe(true);
  }, 120_000);

  it("gives two different drafts issued at the same moment two different numbers", async () => {
    const [one, two] = await Promise.all([draftFor(), draftFor()]);
    const [first, second] = await Promise.all([issueInvoice(a.client, one.invoice.id, one.invoice.version), issueInvoice(a.client, two.invoice.id, two.invoice.version)]);
    expect(first.invoice.invoice_number).not.toBe(second.invoice.invoice_number);
  }, 120_000);

  it("gives 10 different drafts issued at once 10 distinct numbers with no gap and no duplicate", async () => {
    const tenant = await createTenant("invoice-conc-numbers");
    try {
      const cat = await seedCatalogWithClient(tenant.client);
      const drafts = [];
      for (let i = 0; i < 10; i += 1) {
        const order = await seedConfirmedOrderOn(tenant.client, cat);
        drafts.push((await createInvoice(tenant.client, { id: randomUUID(), order_id: order.orderId })).invoice);
      }
      const issued = await Promise.all(drafts.map((d) => issueInvoice(tenant.client, d.id, d.version)));
      const numbers = issued.map((r) => r.invoice.invoice_number as number).sort((x, y) => x - y);
      console.log("Invoice numbers issued at once:", numbers.join(", "));
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await deleteTenant(tenant);
    }
  }, 240_000);

  it("uses no number when an issue is refused", async () => {
    const tenant = await createTenant("invoice-conc-refused");
    try {
      const cat = await seedCatalogWithClient(tenant.client);
      const blocked = await seedConfirmedOrderOn(tenant.client, cat, [{ product_id: null, name: "Noran 20mg cap", quantity: 2 }]);
      const draft = (await createInvoice(tenant.client, { id: randomUUID(), order_id: blocked.orderId })).invoice;
      const refusals = await Promise.allSettled(Array.from({ length: 5 }, () => issueInvoice(tenant.client, draft.id, draft.version)));
      expect(refusals.every((r) => r.status === "rejected")).toBe(true);

      const good = await seedConfirmedOrderOn(tenant.client, cat);
      const next = (await createInvoice(tenant.client, { id: randomUUID(), order_id: good.orderId })).invoice;
      const issued = await issueInvoice(tenant.client, next.id, next.version);
      expect(issued.invoice.invoice_number).toBe(1);
    } finally {
      await deleteTenant(tenant);
    }
  }, 240_000);

  it("gives 10 simultaneous cancels of one invoice exactly one cancellation and keeps the first reason", async () => {
    const { invoice } = await draftFor();
    const issued = (await issueInvoice(a.client, invoice.id, invoice.version)).invoice;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => cancelInvoice(a.client, issued.id, `Reason ${i}`)));
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1);
    expect(results.filter((r) => r.replayed === true)).toHaveLength(9);
    expect(new Set(results.map((r) => r.invoice.cancel_reason)).size).toBe(1);
    const events = await a.client.from("invoice_events").select("id").eq("invoice_id", issued.id).eq("event_type", "cancelled");
    expect(events.data).toHaveLength(1);
  }, 120_000);
});
