import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoiceArgs, seedCatalogWithClient, seedConfirmedOrderOn, type ClientCatalog } from "../helpers/invoices";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Two real users on the Supabase test project: business B can never see or change business A's invoices, orders,
// order sheets or counters, even with crafted ids, and a refusal looks exactly like a missing record. Needs migration
// 0007 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("invoice isolation (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let catalog: ClientCatalog;
  let orderId: string;
  let draftId: string;
  let draftVersion: number;
  let draftLine: string;
  let issuedId: string;

  const rpc = async (tenant: TestTenant, fn: string, args: Record<string, unknown>) => {
    const res = await tenant.client.rpc(fn, args);
    if (res.error) throw new Error(`${fn}: ${res.error.message}`);
    return res.data;
  };

  beforeAll(async () => {
    a = await createTenant("invoice-rls-a");
    b = await createTenant("invoice-rls-b");
    catalog = await seedCatalogWithClient(a.client);
    const order = await seedConfirmedOrderOn(a.client, catalog);
    orderId = order.orderId;
    const draft = await rpc(a, "invoice_create", invoiceArgs.create(randomUUID(), orderId));
    draftId = draft.invoice.id;
    draftVersion = draft.invoice.version;
    draftLine = draft.invoice.lines[0].id;
    const other = await seedConfirmedOrderOn(a.client, catalog);
    const second = await rpc(a, "invoice_create", invoiceArgs.create(randomUUID(), other.orderId));
    const issued = await rpc(a, "invoice_issue", invoiceArgs.issue(second.invoice.id, second.invoice.version));
    issuedId = issued.invoice.id;
  }, 240_000);

  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("B reads nothing of A through the read functions", async () => {
    expect(await rpc(b, "invoice_get", { p_id: draftId })).toEqual({ found: false });
    expect(await rpc(b, "invoice_get", { p_id: issuedId })).toEqual({ found: false });
    expect(await rpc(b, "invoice_list", { p_status: "all", p_store: null, p_from: null, p_to: null, p_order: orderId, p_q: null, p_limit: 50, p_offset: 0 })).toEqual({ items: [], total: 0 });
    expect(await rpc(b, "invoice_todo", { p_q: null, p_limit: 50, p_offset: 0 })).toEqual({ items: [], total: 0 });
    expect(await rpc(b, "invoice_summary", {})).toEqual({ to_invoice: 0, drafts: 0, issued_today: 0 });
    expect(await rpc(b, "invoice_orders_summary", { p_order: orderId })).toEqual([]);
    expect((await rpc(b, "order_sheet", { p_order_ids: [orderId] })).sections).toEqual([]);
  }, 120_000);

  it("every write by B answers exactly like a missing id and changes nothing of A", async () => {
    const missing = randomUUID();
    const foreign = [
      await rpc(b, "invoice_create", invoiceArgs.create(randomUUID(), orderId)),
      await rpc(b, "invoice_set_quantities", invoiceArgs.setQuantities(draftId, draftVersion, [{ line_id: draftLine, delivered_quantity: 1 }])),
      await rpc(b, "invoice_refresh", invoiceArgs.refresh(draftId, draftVersion)),
      await rpc(b, "invoice_discard", invoiceArgs.discard(draftId, draftVersion)),
      await rpc(b, "invoice_issue", invoiceArgs.issue(draftId, draftVersion)),
      await rpc(b, "invoice_cancel", invoiceArgs.cancel(issuedId, "x")),
    ];
    const absent = [
      await rpc(b, "invoice_create", invoiceArgs.create(randomUUID(), missing)),
      await rpc(b, "invoice_set_quantities", invoiceArgs.setQuantities(missing, 1, [{ line_id: draftLine, delivered_quantity: 1 }])),
      await rpc(b, "invoice_refresh", invoiceArgs.refresh(missing, 1)),
      await rpc(b, "invoice_discard", invoiceArgs.discard(missing, 1)),
      await rpc(b, "invoice_issue", invoiceArgs.issue(missing, 1)),
      await rpc(b, "invoice_cancel", invoiceArgs.cancel(missing, "x")),
    ];
    expect(foreign).toEqual(absent);
    for (const result of foreign) expect(result).toEqual({ done: false, reason: "not_found" });

    const still = await rpc(a, "invoice_get", { p_id: draftId });
    expect(still).toMatchObject({ found: true, status: "draft", version: draftVersion });
    expect(await rpc(a, "invoice_get", { p_id: issuedId })).toMatchObject({ found: true, status: "issued" });
  }, 120_000);

  it("the same invoice id used by two businesses stays separate, and each business counts its own numbers", async () => {
    const catalogB = await seedCatalogWithClient(b.client);
    const orderB = await seedConfirmedOrderOn(b.client, catalogB);
    const sharedId = randomUUID();
    const mine = await seedConfirmedOrderOn(a.client, catalog);
    await rpc(a, "invoice_create", invoiceArgs.create(sharedId, mine.orderId));
    const theirs = await rpc(b, "invoice_create", invoiceArgs.create(sharedId, orderB.orderId));
    expect(theirs).toMatchObject({ done: true, created: true });
    const issued = await rpc(b, "invoice_issue", invoiceArgs.issue(sharedId, theirs.invoice.version));
    expect(issued.invoice.invoice_number).toBe(1);
  }, 240_000);

  it("direct table access: B sees only its own rows, writes are refused, the counter is closed", async () => {
    for (const table of ["invoices", "invoice_lines", "invoice_events"]) {
      const rows = await b.client.from(table).select("business_id");
      expect(rows.error, table).toBeNull();
      expect((rows.data ?? []).every((r) => r.business_id === b.businessId), table).toBe(true);
    }
    const ownRows = await a.client.from("invoices").select("id").eq("id", issuedId);
    expect(ownRows.data).toHaveLength(1);

    expect((await b.client.from("invoices").update({ grand_total: "0" }).eq("id", issuedId)).error).not.toBeNull();
    expect((await a.client.from("invoices").update({ grand_total: "0" }).eq("id", issuedId)).error).not.toBeNull();
    expect((await a.client.from("invoices").delete().eq("id", issuedId)).error).not.toBeNull();
    expect((await a.client.from("invoice_lines").update({ delivered_quantity: 1 }).eq("invoice_id", issuedId)).error).not.toBeNull();
    expect((await a.client.from("invoice_events").delete().eq("invoice_id", issuedId)).error).not.toBeNull();
    expect((await a.client.from("invoice_counters").select("*")).error).not.toBeNull();
    expect((await a.client.from("invoice_counters").update({ last_number: 0 }).eq("business_id", a.businessId ?? "")).error).not.toBeNull();
  }, 120_000);

  it("the internal helpers return nothing for another business and the write helpers cannot be called at all", async () => {
    const json = await b.client.rpc("invoice_json", { p_biz: a.businessId, p_id: issuedId, p_with_events: true });
    expect(json.error).toBeNull();
    expect(json.data).toBeNull();
    const rows = await b.client.rpc("invoice_todo_rows", {});
    expect(rows.error).toBeNull();
    expect((rows.data as Array<{ order_id: string }>).some((r) => r.order_id === orderId)).toBe(false);
    expect((await b.client.rpc("invoice_recompute_total", { p_biz: a.businessId, p_invoice: draftId })).error).not.toBeNull();
    expect((await b.client.rpc("invoice_build_lines", { p_biz: a.businessId, p_invoice: draftId, p_order: orderId })).error).not.toBeNull();
  }, 120_000);

  it("a signed-out visitor can call nothing and read nothing", async () => {
    const anon = anonClient();
    expect((await anon.rpc("invoice_get", { p_id: issuedId })).error).not.toBeNull();
    expect((await anon.rpc("invoice_summary", {})).error).not.toBeNull();
    expect((await anon.rpc("invoice_create", invoiceArgs.create(randomUUID(), orderId))).error).not.toBeNull();
    expect((await anon.from("invoices").select("id")).error).not.toBeNull();
  }, 120_000);
});
