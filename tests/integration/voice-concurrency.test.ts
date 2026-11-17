import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiError } from "@/lib/api/errors";
import { saveOrder } from "@/lib/orders/repository";
import { OrderSaveSchema } from "@/lib/validation/order";
import { parseTranscript } from "@/lib/voice/service";
import { catalogLine, savePayload, seedWithClient, typedLine, type Seeded } from "../helpers/orders";
import { createTenant, deleteTenant, hasTestEnv, serviceClient, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";
import { FakeParser, rawItem, rawParse } from "../helpers/voice";

// Real simultaneous requests against the Supabase test project (Module 008, SC-006 and the limit): the database functions
// serialise them, so a voice order is created once, numbers are never skipped or repeated, and the AI parse limit holds
// under a burst. The AI is a fake: nothing here calls a real service.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const SPOKEN = "Al Shifa Pharmacy: Panadol 2 strips";
const voiceSave = (storeId: string, lines: ReturnType<typeof catalogLine>[], overrides: Record<string, unknown> = {}) =>
  OrderSaveSchema.parse({ ...savePayload(storeId, lines), source: "voice", spoken_text: SPOKEN, ...overrides });

suite("voice concurrency against Supabase", () => {
  let a: TestTenant;
  let seed: Seeded;
  const admin = () => serviceClient();

  beforeAll(async () => {
    a = await createTenant("voice-conc");
    seed = await seedWithClient(a.client);
  }, 120_000);
  afterAll(async () => {
    await deleteTenant(a);
  });

  it("10 simultaneous creates of one voice order (same ids) give one order, one set of lines and one number", async () => {
    const id = randomUUID();
    const body = voiceSave(seed.storeId, [catalogLine(seed.pricedId, 2)]);
    const results = await Promise.all(Array.from({ length: 10 }, () => saveOrder(a.client, id, body)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.result.order.order_number)).size).toBe(1);
    expect(results.every((r) => r.result.order.source === "voice" && r.result.order.status === "draft")).toBe(true);
    const rows = await admin().from("orders").select("id, source, spoken_text").eq("id", id);
    expect(rows.data).toEqual([{ id, source: "voice", spoken_text: SPOKEN }]);
    expect((await admin().from("order_lines").select("id").eq("order_id", id)).data).toHaveLength(1);
    expect((await admin().from("order_events").select("id").eq("order_id", id)).data).toHaveLength(1);
  });

  it("10 different voice orders created at once get 10 distinct numbers with no gap", async () => {
    const before = await admin().from("orders").select("order_number").eq("business_id", a.businessId);
    const start = Math.max(0, ...(before.data ?? []).map((r) => r.order_number as number));
    const results = await Promise.all(Array.from({ length: 10 }, () => saveOrder(a.client, randomUUID(), voiceSave(seed.storeId, [catalogLine(seed.pricedId)]))));
    const numbers = results.map((r) => r.result.order.order_number).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => start + i + 1));
  });

  it("a create repeated after a dropped connection (same ids) gives the stored order and no second one", async () => {
    const id = randomUUID();
    const body = voiceSave(seed.storeId, [catalogLine(seed.pricedId, 3), typedLine("Odd syrup", 1, "bottle")]);
    const first = await saveOrder(a.client, id, body);
    expect(first.created).toBe(true);
    const ordersBefore = (await admin().from("orders").select("id").eq("business_id", a.businessId)).data?.length;
    const retry = await saveOrder(a.client, id, body); // the response "was lost": the same request again
    expect(retry.created).toBe(false);
    expect(retry.result.replayed).toBe(true);
    expect(retry.result.order.id).toBe(first.result.order.id);
    expect(retry.result.order.order_number).toBe(first.result.order.order_number);
    expect(retry.result.order.lines.map((l) => l.id).sort()).toEqual(first.result.order.lines.map((l) => l.id).sort());
    expect((await admin().from("orders").select("id").eq("business_id", a.businessId)).data?.length).toBe(ordersBefore);
  });

  it("a medicine deactivated between the preview and the create is refused and nothing is created partly", async () => {
    const doomed = randomUUID();
    const add = await a.client.from("products").insert({ id: doomed, name: "Doomed Tonic", unit: "bottle" });
    expect(add.error).toBeNull();
    const id = randomUUID();
    const body = voiceSave(seed.storeId, [catalogLine(seed.pricedId, 1), catalogLine(doomed, 2, "bottle")]);
    const off = await a.client.from("products").update({ is_active: false }).eq("id", doomed);
    expect(off.error).toBeNull();
    const refused = await saveOrder(a.client, id, body).then(
      () => null,
      (e: ApiError) => e,
    );
    expect(refused).not.toBeNull();
    expect(refused?.code).toBe("validation_error");
    expect(refused?.message).toMatch(/inactive/i);
    expect((await admin().from("orders").select("id").eq("id", id)).data).toEqual([]);
    expect((await admin().from("order_lines").select("id").eq("order_id", id)).data).toEqual([]);
    expect((await admin().from("order_events").select("id").eq("order_id", id)).data).toEqual([]);
  });

  it("25 simultaneous AI parse checks allow at most 20, the fake parser is called at most 20 times, and the refused ones are told to wait", async () => {
    const t = await createTenant("voice-conc-limit");
    try {
      const parser = new FakeParser(rawParse("Nimer", [rawItem("Brufen", 1, "box")]));
      const settled = await Promise.allSettled(Array.from({ length: 25 }, () => parseTranscript(t.client, { transcript: "Nimer: Brufen 1 box", parser: "ai" }, { parserFor: () => parser })));
      const done = settled.filter((s) => s.status === "fulfilled");
      const refused = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
      expect(done).toHaveLength(20);
      expect(parser.calls).toHaveLength(20);
      expect(refused).toHaveLength(5);
      for (const r of refused) expect((r.reason as ApiError).code).toBe("rate_limited");
      // the burst wrote one rate_limited record, not five
      const log = await admin().from("voice_diagnostics").select("kind").eq("business_id", t.businessId as string).eq("kind", "rate_limited");
      expect(log.data).toHaveLength(1);

      // the simple reader is never counted: simultaneous parses all answer, even while the AI is at its limit
      const simple = await Promise.allSettled(Array.from({ length: 25 }, () => parseTranscript(t.client, { transcript: "Nimer: Brufen 2 box", parser: "rules" })));
      expect(simple.every((s) => s.status === "fulfilled")).toBe(true);
    } finally {
      await deleteTenant(t);
    }
  });
});
