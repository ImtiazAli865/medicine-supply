import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStore } from "@/lib/stores/repository";
import { bothTenants, insertMedicines } from "../helpers/fast";
import { catalogLine, saveArgs, savePayload, typedLine } from "../helpers/orders";
import { deleteTenant, hasTestEnv, SKIP_REASON, serviceClient, type TestTenant } from "../helpers/supabase-test";
import { seedStoreWithClient } from "../helpers/fast";

// What the offline queue relies on (Module 009): the existing order save and store create are safe to repeat. Against the real
// Supabase test project with two real businesses.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("repeated sends are applied once (real Supabase test project)", () => {
  let a: TestTenant;
  let b: TestTenant;
  let aStore: string;
  let med: string;

  beforeAll(async () => {
    ({ a, b } = await bothTenants());
    aStore = await seedStoreWithClient(a.client, "Replay Store");
    [med] = (await insertMedicines(a.client, [{ name: "Replay Med", strength: "5 mg" }])) as [string];
  }, 90_000);

  afterAll(async () => {
    await Promise.all([a && deleteTenant(a), b && deleteTenant(b)]);
  }, 60_000);

  async function countOrders(tenant: TestTenant): Promise<number> {
    const { count } = await serviceClient().from("orders").select("id", { count: "exact", head: true }).eq("business_id", tenant.businessId!);
    return count ?? 0;
  }

  it("the same save repeated with the same request id is replayed: one order, one copy of each line", async () => {
    const orderId = randomUUID();
    const payload = savePayload(aStore, [catalogLine(med, 3), typedLine("Typed Replay", 2, "box")]);
    const before = await countOrders(a);
    const first = await a.client.rpc("order_save", saveArgs(orderId, payload));
    expect(first.data).toMatchObject({ saved: true, created: true });
    const second = await a.client.rpc("order_save", saveArgs(orderId, payload));
    const third = await a.client.rpc("order_save", saveArgs(orderId, payload));
    expect(second.data).toMatchObject({ saved: true, replayed: true });
    expect(third.data).toMatchObject({ saved: true, replayed: true });
    expect(second.data.order.version).toBe(first.data.order.version);
    expect(second.data.order.lines).toHaveLength(2);
    expect(await countOrders(a)).toBe(before + 1);
    const { data: lines } = await serviceClient().from("order_lines").select("id,name,quantity,unit").eq("order_id", orderId).is("removed_at", null);
    expect(lines).toHaveLength(2);
    expect(lines!.map((l) => l.name).sort()).toEqual(["Replay Med", "Typed Replay"]);
  });

  it("a lost response (the request was applied, the phone retries with the same id and payload) gives the same order, not a second one", async () => {
    const orderId = randomUUID();
    const payload = savePayload(aStore, [typedLine("Lost Response", 1)]);
    const applied = await a.client.rpc("order_save", saveArgs(orderId, payload));
    expect(applied.data.saved).toBe(true);
    // the phone never saw that answer: it sends the identical request again
    const retry = await a.client.rpc("order_save", saveArgs(orderId, payload));
    expect(retry.data).toMatchObject({ saved: true, replayed: true });
    expect(retry.data.order.id).toBe(orderId);
    expect(retry.data.order.order_number).toBe(applied.data.order.order_number);
  });

  it("a later change sent with the version the first save returned is applied once, and repeating it is replayed", async () => {
    const orderId = randomUUID();
    const first = await a.client.rpc("order_save", saveArgs(orderId, savePayload(aStore, [typedLine("Change One", 1)])));
    const change = savePayload(aStore, [typedLine("Change One", 1), typedLine("Change Two", 4)], { expected_version: first.data.order.version });
    const sent = await a.client.rpc("order_save", saveArgs(orderId, change));
    const again = await a.client.rpc("order_save", saveArgs(orderId, change));
    expect(sent.data).toMatchObject({ saved: true });
    expect(again.data).toMatchObject({ saved: true, replayed: true });
    expect(again.data.order.version).toBe(sent.data.order.version);
    expect(again.data.order.lines).toHaveLength(2);
  });

  it("a new request id that repeats the first creation is a version conflict, never a second order", async () => {
    const orderId = randomUUID();
    await a.client.rpc("order_save", saveArgs(orderId, savePayload(aStore, [typedLine("Created Once", 1)])));
    const before = await countOrders(a);
    const clash = await a.client.rpc("order_save", saveArgs(orderId, savePayload(aStore, [typedLine("Created Twice", 1)])));
    expect(clash.data).toMatchObject({ saved: false, reason: "version_conflict" });
    expect(clash.data.current.lines.map((l: { name: string }) => l.name)).toEqual(["Created Once"]);
    expect(await countOrders(a)).toBe(before);
  });

  it("creating a store repeated with the same id gives one store", async () => {
    const id = randomUUID();
    const input = { id, name: "Replay Made Offline", contact_person: null, phone: null, address: null, notes: null, confirm_duplicate: false };
    const first = await createStore(a.client, input);
    const second = await createStore(a.client, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const { count } = await serviceClient().from("stores").select("id", { count: "exact", head: true }).eq("id", id);
    expect(count).toBe(1);
  });

  it("another business can neither replay nor read the first business's order, and the order stays as it was", async () => {
    const orderId = randomUUID();
    const payload = savePayload(aStore, [typedLine("Private To A", 1)]);
    const created = await a.client.rpc("order_save", saveArgs(orderId, payload));
    expect(created.data.saved).toBe(true);
    const bStore = await seedStoreWithClient(b.client, "Beta Replay Store");
    const attempt = await b.client.rpc("order_save", saveArgs(orderId, savePayload(bStore, [typedLine("Stolen", 1)], { request_id: payload.request_id })));
    // not replayed, not created: the id belongs to the other business
    expect(attempt.data?.replayed).not.toBe(true);
    expect(JSON.stringify(attempt.data ?? attempt.error)).not.toContain("Private To A");
    const read = await b.client.rpc("order_get", { p_id: orderId });
    expect(read.data).toBeNull();
    const { data: lines } = await serviceClient().from("order_lines").select("name").eq("order_id", orderId).is("removed_at", null);
    expect(lines!.map((l) => l.name)).toEqual(["Private To A"]);
  });
});
