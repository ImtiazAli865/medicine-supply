import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typedLine as helperTypedLine } from "../helpers/orders";
import { seedMedicineWithClient, seedStoreWithClient } from "../helpers/pending";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// Isolation of the Module 008 tables and functions against the real Supabase test project with two real users and a
// signed-out visitor. Needs migration 0009 on the test project.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const typedLine = (name: string, quantity: number) => helperTypedLine(name, quantity, "box");

suite("voice isolation (Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let storeA: string;
  let storeB: string;
  let productA: string;

  beforeAll(async () => {
    a = await createTenant("rls-voice-a");
    b = await createTenant("rls-voice-b");
    storeA = await seedStoreWithClient(a.client, "Al Madina Medical");
    storeB = await seedStoreWithClient(b.client, "Zam Zam Traders");
    productA = await seedMedicineWithClient(a.client, { name: "Panadol", brand: "Panadol", strength: "500 mg", unit: "strip" });
    await a.client.rpc("voice_diag_add", { p_kind: "ai_busy", p_parser: "ai", p_items: 1, p_doubtful: 0, p_unreadable: 0, p_transcript_length: 10, p_message: "A record" });
    await b.client.rpc("voice_diag_add", { p_kind: "ai_timeout", p_parser: "ai", p_items: 0, p_doubtful: 0, p_unreadable: 0, p_transcript_length: 5, p_message: "B record" });
  }, 240_000);

  afterAll(async () => {
    if (a) await deleteTenant(a);
    if (b) await deleteTenant(b);
  });

  it("lists and reads only the caller's diagnostic records", async () => {
    const listA = await a.client.rpc("voice_diag_list", { p_limit: 20, p_offset: 0 });
    const listB = await b.client.rpc("voice_diag_list", { p_limit: 20, p_offset: 0 });
    expect(listA.error).toBeNull();
    expect((listA.data as { items: Array<{ message: string }> }).items.map((r) => r.message)).toEqual(["A record"]);
    expect((listB.data as { items: Array<{ message: string }> }).items.map((r) => r.message)).toEqual(["B record"]);
    const directB = await b.client.from("voice_diagnostics").select("message");
    expect(directB.error).toBeNull();
    expect((directB.data ?? []).map((r) => r.message)).toEqual(["B record"]);
  });

  it("refuses direct writes to the diagnostic log and any direct access to the parse attempts", async () => {
    const insert = await a.client.from("voice_diagnostics").insert({ business_id: b.businessId, kind: "ai_busy", parser: "ai" });
    expect(insert.error?.code).toBe("42501");
    const update = await a.client.from("voice_diagnostics").update({ message: "changed" }).eq("message", "A record");
    expect(update.error?.code).toBe("42501");
    const del = await a.client.from("voice_diagnostics").delete().eq("message", "A record");
    expect(del.error?.code).toBe("42501");
    await a.client.rpc("voice_parse_allow");
    expect((await a.client.from("voice_parse_attempts").select("*")).error?.code).toBe("42501");
    expect((await a.client.from("voice_parse_attempts").insert({ business_id: a.businessId })).error?.code).toBe("42501");
    const still = await a.client.rpc("voice_diag_list", { p_limit: 20, p_offset: 0 });
    expect((still.data as { total: number }).total).toBe(1);
  });

  it("matching returns only the caller's records", async () => {
    const forB = await b.client.rpc("voice_match_products", { p_names: ["Panadol"] });
    expect(forB.error).toBeNull();
    expect(forB.data ?? []).toEqual([]);
    const forA = await a.client.rpc("voice_match_products", { p_names: ["Panadol"] });
    expect((forA.data as Array<{ id: string }>).map((r) => r.id)).toEqual([productA]);
    const storesForB = await b.client.rpc("voice_match_stores", { p_name: "Al Madina Medical" });
    expect((storesForB.data as Array<{ id: string }>).some((s) => s.id === storeA)).toBe(false);
  });

  it("the order save refuses another business's order id and store and creates nothing", async () => {
    const orderId = randomUUID();
    const made = await a.client.rpc("order_save", {
      p_id: orderId, p_request_id: randomUUID(), p_expected_version: null, p_store_id: storeA, p_notes: null, p_lines: [typedLine("Thing", 1)], p_source: "voice", p_spoken_text: "Thing 1",
    });
    expect(made.data).toMatchObject({ saved: true, created: true });

    const crafted = await b.client.rpc("order_save", {
      p_id: orderId, p_request_id: randomUUID(), p_expected_version: null, p_store_id: storeB, p_notes: null, p_lines: [typedLine("Stolen", 9)], p_source: "voice", p_spoken_text: "Stolen 9",
    });
    expect(crafted.data).toEqual({ saved: false, reason: "unusable_id" });
    const foreignStore = await b.client.rpc("order_save", {
      p_id: randomUUID(), p_request_id: randomUUID(), p_expected_version: null, p_store_id: storeA, p_notes: null, p_lines: [typedLine("Thing", 1)], p_source: "voice", p_spoken_text: "Thing 1",
    });
    expect(foreignStore.data).toMatchObject({ saved: false, reason: "store_not_found" });

    const seenByB = await b.client.from("orders").select("id").eq("id", orderId);
    expect(seenByB.data ?? []).toEqual([]);
    const seenByA = await a.client.from("orders").select("id, spoken_text").eq("id", orderId);
    expect(seenByA.data).toEqual([{ id: orderId, spoken_text: "Thing 1" }]);
  });

  it("a signed-out visitor reaches nothing", async () => {
    const anon = anonClient();
    expect((await anon.rpc("voice_parse_allow")).error?.code).toBe("42501");
    expect((await anon.rpc("voice_diag_list", { p_limit: 20, p_offset: 0 })).error?.code).toBe("42501");
    expect((await anon.rpc("voice_diag_add", { p_kind: "ai_busy", p_parser: "ai", p_items: 0, p_doubtful: 0, p_unreadable: 0, p_transcript_length: 0, p_message: null })).error?.code).toBe("42501");
    expect((await anon.rpc("voice_match_products", { p_names: ["Panadol"] })).error?.code).toBe("42501");
    expect((await anon.rpc("voice_match_stores", { p_name: "Al Madina" })).error?.code).toBe("42501");
    expect((await anon.from("voice_diagnostics").select("*")).error?.code).toBe("42501");
  });
});
