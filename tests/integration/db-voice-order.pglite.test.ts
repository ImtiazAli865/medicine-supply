import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel, dbConfirm, dbGet, dbSave } from "../helpers/orders-db";
import { catalogLine, savePayload, typedLine, seedWithDb, type Seeded } from "../helpers/orders";
import { createInvoiceDraft } from "../helpers/invoices-db";
import { insertMedicine } from "../helpers/pending-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { dbManualSaveOldForm, dbVoiceSave } from "../helpers/voice-db";

// A voice order through the extended order_save (Module 008): created once, as an ordinary draft, with the spoken text
// kept read-only; the manual path is unchanged; and a voice draft is an ordinary order in every later step.

let db: PGlite;
let a: Tenant;
let b: Tenant;
let seeded: Seeded;
let seededB: Seeded;

const SPOKEN = "Nimer: Panadol 20 strips, Brufen 10 box";

const count = async (table: string, where = "true"): Promise<number> =>
  Number((await db.query<{ c: string }>(`select count(*) as c from public.${table} where ${where}`)).rows[0].c);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-order-a");
  b = await createTenant(db, "voice-order-b");
  seeded = await seedWithDb(db, a.businessId);
  seededB = await seedWithDb(db, b.businessId);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("creating a voice order", () => {
  it("makes one Draft order with its lines, number, created event, source voice and the spoken text", async () => {
    const orderId = randomUUID();
    const lines = [catalogLine(seeded.pricedId, 20, "strips"), typedLine("Noran 20mg cap", 3, "strip")];
    const res = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, lines, { spokenText: SPOKEN });
    expect(res).toMatchObject({ saved: true, created: true, replayed: false });
    expect(res.order).toMatchObject({ id: orderId, status: "draft", source: "voice", spoken_text: SPOKEN, version: 1 });
    expect(res.order?.order_number).toBeGreaterThan(0);
    expect(res.order?.lines).toHaveLength(2);
    expect(await count("orders", `id = '${orderId}'`)).toBe(1);
    expect(await count("order_lines", `order_id = '${orderId}'`)).toBe(2);
    const events = await db.query<{ event_type: string }>(`select event_type from public.order_events where order_id = $1`, [orderId]);
    expect(events.rows.map((r) => r.event_type)).toEqual(["created"]);
    // nothing is confirmed, priced or invoiced by creating
    const row = await db.query<{ confirmed_at: string | null; selling_price_snapshot: string | null }>(
      `select o.confirmed_at, (select max(selling_price_snapshot) from public.order_lines where order_id = o.id) as selling_price_snapshot from public.orders o where o.id = $1`,
      [orderId],
    );
    expect(row.rows[0]).toEqual({ confirmed_at: null, selling_price_snapshot: null });
  });

  it("replays with the same ids: one order, one set of lines, one number", async () => {
    const orderId = randomUUID();
    const requestId = randomUUID();
    const lines = [catalogLine(seeded.pricedId, 5, "strips")];
    const first = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, lines, { requestId, spokenText: SPOKEN });
    const again = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, lines, { requestId, spokenText: SPOKEN });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ saved: true, replayed: true, created: false });
    expect(again.order?.order_number).toBe(first.order?.order_number);
    expect(await count("orders", `id = '${orderId}'`)).toBe(1);
    expect(await count("order_lines", `order_id = '${orderId}'`)).toBe(1);
  });

  it("ignores the source and the spoken text on a later save of the same order", async () => {
    const orderId = randomUUID();
    const lines = [catalogLine(seeded.pricedId, 5, "strips")];
    const created = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, lines, { spokenText: SPOKEN });
    const edited = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, [{ ...lines[0], quantity: 9 }], {
      expectedVersion: created.order?.version,
      source: "manual",
      spokenText: null,
    });
    expect(edited.saved).toBe(true);
    expect(edited.order).toMatchObject({ source: "voice", spoken_text: SPOKEN });
    expect(edited.order?.lines[0].quantity).toBe(9);
    // even a conflicting value is ignored (validated, then not applied)
    const again = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, [{ ...lines[0], quantity: 10 }], {
      expectedVersion: edited.order?.version,
      source: "voice",
      spokenText: "something else",
    });
    expect(again.order).toMatchObject({ source: "voice", spoken_text: SPOKEN });
  });

  it("keeps a typed line's exact name and makes it a pending line", async () => {
    const orderId = randomUUID();
    const res = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, [typedLine("  Noran   20mg  cap ", 3, "strip")], { spokenText: SPOKEN });
    expect(res.saved).toBe(true);
    const line = await db.query<{ name: string; item_status: string; product_id: string | null }>(`select name, item_status, product_id from public.order_lines where order_id = $1`, [orderId]);
    expect(line.rows[0].item_status).toBe("pending_registration");
    expect(line.rows[0].product_id).toBeNull();
    expect(line.rows[0].name.replace(/\s+/g, " ").trim()).toBe("Noran 20mg cap");
  });
});

describe("refusals write nothing", () => {
  it("refuses a voice order without spoken text, a blank or too long text, a manual order with text, and an unknown source", async () => {
    const lines = [catalogLine(seeded.pricedId, 1)];
    const before = await count("orders");
    const cases: Array<[string, { source?: string; spokenText?: string | null }]> = [
      ["voice, no text", { source: "voice", spokenText: null }],
      ["voice, blank", { source: "voice", spokenText: "   " }],
      ["voice, too long", { source: "voice", spokenText: "x".repeat(2001) }],
      ["manual, with text", { source: "manual", spokenText: "Panadol" }],
      ["unknown source", { source: "robot", spokenText: "Panadol" }],
    ];
    for (const [label, options] of cases) {
      const res = await dbVoiceSave(db, a.userId, randomUUID(), seeded.storeId, lines, options);
      expect(res, label).toMatchObject({ saved: false, reason: "invalid_lines" });
    }
    expect(await count("orders")).toBe(before);
  });

  it("accepts exactly 2,000 characters of spoken text", async () => {
    const res = await dbVoiceSave(db, a.userId, randomUUID(), seeded.storeId, [catalogLine(seeded.pricedId, 1)], { spokenText: "x".repeat(2000) });
    expect(res.saved).toBe(true);
  });

  it("accepts 200 lines and refuses 201, writing nothing", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => typedLine(`Medicine ${i}`, 1, "strip"));
    const ok = await dbVoiceSave(db, a.userId, randomUUID(), seeded.storeId, many(200), { spokenText: SPOKEN });
    expect(ok.saved).toBe(true);
    const before = await count("orders");
    const refused = await dbVoiceSave(db, a.userId, randomUUID(), seeded.storeId, many(201), { spokenText: SPOKEN });
    expect(refused).toMatchObject({ saved: false, reason: "invalid_lines" });
    expect(await count("orders")).toBe(before);
  });

  it("refuses a medicine of another business and an inactive one, creating nothing partly", async () => {
    const inactive = await insertMedicine(db, a.businessId, { name: "Disprin", unit: "strip", is_active: false });
    const before = { orders: await count("orders"), lines: await count("order_lines") };
    for (const productId of [seededB.pricedId, inactive]) {
      const res = await dbVoiceSave(db, a.userId, randomUUID(), seeded.storeId, [catalogLine(seeded.pricedId, 1), catalogLine(productId, 2)], { spokenText: SPOKEN });
      expect(res.saved).toBe(false);
    }
    expect(await count("orders")).toBe(before.orders);
    expect(await count("order_lines")).toBe(before.lines);
  });

  it("refuses another business's store", async () => {
    const before = await count("orders");
    const res = await dbVoiceSave(db, a.userId, randomUUID(), seededB.storeId, [typedLine("Thing", 1)], { spokenText: SPOKEN });
    expect(res.saved).toBe(false);
    expect(await count("orders")).toBe(before);
  });
});

describe("the manual path is unchanged", () => {
  it("creates a manual order with no spoken text through the old six-argument call form", async () => {
    const orderId = randomUUID();
    const res = await dbManualSaveOldForm(db, a.userId, orderId, seeded.storeId, [catalogLine(seeded.pricedId, 4)]);
    expect(res).toMatchObject({ saved: true, created: true });
    expect(res.order).toMatchObject({ source: "manual", spoken_text: null });
  });

  it("creates a manual order through the existing helper too", async () => {
    const orderId = randomUUID();
    const res = await dbSave(db, a.userId, orderId, savePayload(seeded.storeId, [catalogLine(seeded.pricedId, 4)]));
    expect(res.saved).toBe(true);
    expect(res.order?.source).toBe("manual");
  });
});

describe("a voice draft is an ordinary order afterwards", () => {
  it("can be edited, confirmed with price snapshots exactly like a manual order, and cancelled", async () => {
    const voiceId = randomUUID();
    const manualId = randomUUID();
    const lines = () => [catalogLine(seeded.pricedId, 4, "strip"), typedLine("Noran 20mg cap", 2, "strip")];
    const voice = await dbVoiceSave(db, a.userId, voiceId, seeded.storeId, lines(), { spokenText: SPOKEN });
    const manual = await dbSave(db, a.userId, manualId, savePayload(seeded.storeId, lines()));

    const confirmedVoice = await dbConfirm(db, a.userId, voiceId, voice.order?.version ?? 1);
    const confirmedManual = await dbConfirm(db, a.userId, manualId, manual.order?.version ?? 1);
    expect(confirmedVoice.confirmed).toBe(true);
    const voiceView = await dbGet(db, a.userId, voiceId);
    const manualView = await dbGet(db, a.userId, manualId);
    expect(voiceView).toMatchObject({ status: "confirmed", source: "voice", spoken_text: SPOKEN });
    // the same snapshot prices and totals as a manual order with the same lines
    expect(voiceView?.lines.map((l) => [l.price_basis, l.selling_price, l.line_total])).toEqual(manualView?.lines.map((l) => [l.price_basis, l.selling_price, l.line_total]));
    expect(voiceView?.totals).toEqual(manualView?.totals);
    expect(confirmedManual.confirmed).toBe(true);

    // an edit of a confirmed voice order keeps the source and the spoken text
    const edit = await dbVoiceSave(db, a.userId, voiceId, seeded.storeId, [{ ...voiceView!.lines[0], id: voiceView!.lines[0].id, product_id: seeded.pricedId, name: null, quantity: 6, unit: "strip" }, { id: voiceView!.lines[1].id, product_id: null, name: "Noran 20mg cap", quantity: 2, unit: "strip" }], {
      expectedVersion: voiceView?.version,
      source: "manual",
      spokenText: null,
    });
    expect(edit.saved).toBe(true);
    expect(edit.order).toMatchObject({ source: "voice", spoken_text: SPOKEN });

    const cancelled = await dbCancel(db, a.userId, voiceId, edit.order?.version ?? null, "Store changed its mind");
    expect(cancelled.cancelled).toBe(true);
    expect((await dbGet(db, a.userId, voiceId))?.spoken_text).toBe(SPOKEN);
  });

  it("accepts an invoice draft for a confirmed voice order through the existing invoice functions", async () => {
    const orderId = randomUUID();
    const voice = await dbVoiceSave(db, a.userId, orderId, seeded.storeId, [catalogLine(seeded.pricedId, 3, "strip")], { spokenText: SPOKEN });
    const confirmed = await dbConfirm(db, a.userId, orderId, voice.order?.version ?? 1);
    expect(confirmed.confirmed).toBe(true);
    const invoice = await createInvoiceDraft(db, a.userId, orderId);
    expect(invoice.status).toBe("draft");
    expect(invoice.grand_total).toBe("376.50");
    // the invoice carries no spoken text
    expect(JSON.stringify(invoice)).not.toMatch(/spoken/i);
  });
});
