import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOrder, saveOrder } from "@/lib/orders/repository";
import { OrderSaveSchema } from "@/lib/validation/order";
import { matchProducts, matchStores } from "@/lib/voice/repository";
import { parseTranscript } from "@/lib/voice/service";
import { scanForbiddenKeys } from "../helpers/accounts";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";
import { FakeParser } from "../helpers/voice";

// The voice functions and the extended order save against the real Supabase test project with two real users: matching
// returns only the caller's active records, the parse service matches by application code, and a voice order is created
// once, as a draft, by the supplier's own call. Needs migration 0009 on the test project. The AI is a fake: no test ever
// calls the real service.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("voice matching and voice orders (Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;
  let panadol500: string;
  let panadol650: string;
  let brufen: string;
  let inactive: string;

  beforeAll(async () => {
    a = await createTenant("voice-api-a");
    b = await createTenant("voice-api-b");
    storeA = await seedStoreWithClient(a.client, "Al Madina Medical");
    await seedStoreWithClient(a.client, "Madina Medical Store");
    panadol500 = await seedMedicineWithClient(a.client, { name: "Panadol", brand: "Panadol", strength: "500 mg", dosage_form: "tablet", unit: "strip" });
    panadol650 = await seedMedicineWithClient(a.client, { name: "Panadol", brand: "Panadol", strength: "650 mg", dosage_form: "tablet", unit: "strip" });
    brufen = await seedMedicineWithClient(a.client, { name: "Brufen", brand: "Brufen", strength: "400 mg", dosage_form: "tablet", unit: "box" });
    inactive = await seedMedicineWithClient(a.client, { name: "Disprin", strength: "300 mg", unit: "strip" });
    const off = await a.client.from("products").update({ is_active: false }).eq("id", inactive);
    if (off.error) throw new Error(off.error.message);
    await seedMedicineWithClient(b.client, { name: "Panadol", brand: "Panadol", strength: "500 mg", unit: "strip" });
    await seedStoreWithClient(b.client, "Al Madina Medical");
  }, 240_000);

  afterAll(async () => {
    if (a) await deleteTenant(a);
    if (b) await deleteTenant(b);
  });

  it("returns only the caller's active medicines, with exact forms first, and no price column", async () => {
    const rows = await matchProducts(a.client, ["Panadol", "Brufen", "Disprin", "Xyzzin"]);
    const forPanadol = rows.filter((r) => r.idx === 0);
    expect(forPanadol.map((r) => r.id).sort()).toEqual([panadol500, panadol650].sort());
    expect(forPanadol.every((r) => r.is_exact)).toBe(true);
    expect(rows.filter((r) => r.idx === 1).map((r) => r.id)).toEqual([brufen]);
    // an inactive medicine and an unknown name come back with nothing
    expect(rows.filter((r) => r.idx === 2)).toHaveLength(0);
    expect(rows.filter((r) => r.idx === 3)).toHaveLength(0);
    expect(scanForbiddenKeys(rows)).toEqual([]);
    expect(Object.keys(rows[0]).join(" ")).not.toMatch(/price|mrp|cost|margin|profit/i);
  });

  it("matches a near spelling as a non-exact candidate", async () => {
    const rows = await matchProducts(a.client, ["Panadl"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.is_exact === false)).toBe(true);
  });

  it("matches the spoken store: exact and near", async () => {
    const exact = await matchStores(a.client, "Al Madina Medical");
    expect(exact.filter((s) => s.is_exact).map((s) => s.id)).toEqual([storeA]);
    const near = await matchStores(a.client, "Madina");
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(near.every((s) => !s.is_exact)).toBe(true);
    expect(await matchStores(a.client, "")).toEqual([]);
  });

  it("shows business B nothing of business A, and the same spoken name resolves to B's own record", async () => {
    const own = await matchProducts(b.client, ["Panadol"]);
    expect(own).toHaveLength(1);
    expect(own[0].id).not.toBe(panadol500);
    expect((await matchProducts(b.client, ["Brufen"])).filter((r) => r.idx === 0)).toHaveLength(0);
    const stores = await matchStores(b.client, "Al Madina Medical");
    expect(stores).toHaveLength(1);
    expect(stores[0].id).not.toBe(storeA);
  });

  it("builds a preview with the real database: matched, choose one and unknown, with no price anywhere", async () => {
    const raw = {
      store: "Al Madina Medical",
      items: [
        { name: "Panadol", quantity: 20, unit: "strips" },
        { name: "Brufen", quantity: 10, unit: null },
        { name: "Xyzzin", quantity: 3, unit: "box" },
      ],
      unreadable: [],
    };
    const preview = await parseTranscript(a.client, { transcript: "Al Madina Medical: Panadol 20 strips, Brufen 10, Xyzzin 3 box", parser: "ai" }, { parserFor: () => new FakeParser(raw) });
    expect(preview.store).toMatchObject({ state: "matched", storeId: storeA });
    expect(preview.lines.map((l) => l.state)).toEqual(["choose_one", "matched", "unknown"]);
    expect(preview.lines[0].candidates).toHaveLength(2);
    expect(preview.lines[1]).toMatchObject({ productId: brufen, unit: "box" });
    expect(preview.lines[1].flags).toContain("unit_not_heard");
    expect(preview.lines[2]).toMatchObject({ candidates: [], productId: null, quantity: 3 });
    expect(scanForbiddenKeys(preview)).toEqual([]);
  });

  it("reads a clear sentence with the simple reader and the real matching", async () => {
    const preview = await parseTranscript(a.client, { transcript: "Al Madina Medical: Brufen 4 box", parser: "rules" });
    expect(preview.parser).toBe("rules");
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ state: "matched", productId: brufen, quantity: 4, unit: "box" });
  });

  it("creates a voice order only when the supplier's own call is made, once, as a draft with its spoken text", async () => {
    const orderId = randomUUID();
    expect(await getOrder(a.client, orderId)).toBeNull();
    const spoken = "Al Madina Medical: Brufen 4 box";
    const body = OrderSaveSchema.parse({
      request_id: randomUUID(),
      expected_version: null,
      store_id: storeA,
      notes: null,
      lines: [{ id: randomUUID(), product_id: brufen, name: null, quantity: 4, unit: "box" }],
      source: "voice",
      spoken_text: spoken,
    });
    const first = await saveOrder(a.client, orderId, body);
    expect(first.created).toBe(true);
    expect(first.result.order).toMatchObject({ status: "draft", source: "voice", spoken_text: spoken });
    const again = await saveOrder(a.client, orderId, body);
    expect(again.created).toBe(false);
    expect(again.result.replayed).toBe(true);
    expect(again.result.order.order_number).toBe(first.result.order.order_number);
    // the order is visible to its owner only
    expect(await getOrder(b.client, orderId)).toBeNull();
    expect(JSON.stringify(first.result.order)).not.toMatch(/purchase_price|"mrp"/i);
  });

  it("keeps a manual order manual with no spoken text", async () => {
    const orderId = randomUUID();
    const body = OrderSaveSchema.parse({
      request_id: randomUUID(),
      expected_version: null,
      store_id: storeA,
      notes: null,
      lines: [{ id: randomUUID(), product_id: brufen, name: null, quantity: 1, unit: "box" }],
    });
    const { result } = await saveOrder(a.client, orderId, body);
    expect(result.order).toMatchObject({ source: "manual", spoken_text: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Part 2: the AI limit, the failures and the diagnostic log with the real database.
// ---------------------------------------------------------------------------------------------------------------

import { ParserError } from "@/lib/voice/parser";
import { listDiagnostics } from "@/lib/voice/repository";
import { DiagnosticsQuerySchema } from "@/lib/validation/voice";
import { rawItem, rawParse } from "../helpers/voice";

suite("voice limits, failures and the diagnostic log (Supabase test project)", () => {
  let c: TestTenant;
  let d: TestTenant;

  const log = async (tenant: TestTenant) => (await listDiagnostics(tenant.client, DiagnosticsQuerySchema.parse({ limit: "50" }))).items;

  beforeAll(async () => {
    c = await createTenant("voice-api-c");
    d = await createTenant("voice-api-d");
    await seedStoreWithClient(c.client, "Nimer");
    await seedMedicineWithClient(c.client, { name: "Brufen", unit: "box" });
  }, 240_000);

  afterAll(async () => {
    if (c) await deleteTenant(c);
    if (d) await deleteTenant(d);
  });

  it("refuses the 21st AI parse in a minute before any AI call, while the simple reader still answers", async () => {
    const parser = new FakeParser(rawParse("Nimer", [rawItem("Brufen", 1, "box")]));
    for (let i = 0; i < 20; i += 1) await parseTranscript(c.client, { transcript: "Nimer: Brufen 1 box", parser: "ai" }, { parserFor: () => parser });
    expect(parser.calls).toHaveLength(20);
    const refused = await parseTranscript(c.client, { transcript: "Nimer: Brufen 1 box", parser: "ai" }, { parserFor: () => parser }).catch((e) => e);
    expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
    expect(parser.calls).toHaveLength(20);

    const simple = await parseTranscript(c.client, { transcript: "Nimer: Brufen 2 box", parser: "rules" });
    expect(simple.lines).toHaveLength(1);

    // repeated refusals in the same minute write one rate_limited record
    for (let i = 0; i < 4; i += 1) await parseTranscript(c.client, { transcript: "x", parser: "ai" }, { parserFor: () => parser }).catch(() => undefined);
    expect((await log(c)).filter((r) => r.kind === "rate_limited")).toHaveLength(1);
  });

  it("writes the right diagnostic kind for each failure, with counts and the length only", async () => {
    const transcript = "Nimer: SECRET-LOOKING-TEXT 5 box";
    const kinds = ["ai_busy", "ai_timeout", "ai_invalid", "ai_unavailable", "ai_not_configured"] as const;
    for (const kind of kinds) {
      const error = await parseTranscript(d.client, { transcript, parser: "rules" }, { parserFor: () => new FakeParser(new ParserError(kind)) }).catch((e) => e);
      expect(error, kind).toMatchObject({ code: kind });
    }
    const records = await log(d);
    expect(records.map((r) => r.kind).sort()).toEqual([...kinds].sort());
    for (const record of records) {
      expect(record.transcript_length).toBe(transcript.length);
      expect(record.item_count).toBe(0);
      expect(JSON.stringify(record)).not.toMatch(/SECRET-LOOKING-TEXT|Nimer|price|balance/i);
    }
  });

  it("writes one low_confidence record for a doubtful but successful parse, and none for a clean one", async () => {
    const before = (await log(d)).length;
    await parseTranscript(d.client, { transcript: "t", parser: "ai" }, { parserFor: () => new FakeParser(rawParse(null, [rawItem("Unknown thing", 1, "box")])) });
    const after = await log(d);
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ kind: "low_confidence", parser: "ai", item_count: 1, doubtful_count: 1 });
  });

  it("shows each business only its own records", async () => {
    const mine = await log(d);
    const theirs = await log(c);
    expect(mine.some((r) => theirs.some((t) => t.id === r.id))).toBe(false);
    expect(scanForbiddenKeys(mine)).toEqual([]);
  });
});
