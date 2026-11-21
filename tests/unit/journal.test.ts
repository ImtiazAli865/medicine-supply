import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { emptyDraft, Journal, STORAGE_FAILED_MESSAGE } from "@/lib/device/journal";
import type { BusinessDatabase, DraftRecord } from "@/lib/device/schema";
import type { EditorState } from "@/lib/orders/editor-state";
import type { Order } from "@/lib/orders/types";

const BIZ = "123e4567-e89b-42d3-a456-426614174000";

async function setup() {
  const storage = new MemoryDeviceStorage();
  const r = await storage.openBusiness(BIZ);
  if (!r.ok) throw new Error("open failed");
  return { storage, db: r.db as BusinessDatabase, journal: new Journal(r.db) };
}

function state(notes = ""): EditorState {
  return { storeId: "s1", notes, lines: [{ id: "l1", product_id: null, name: "Typed", quantity: 2, unit: "strip" }] };
}

async function create(journal: Journal, id: string, notes = "") {
  return journal.apply(id, null, () => emptyDraft(id, state(notes), {}, "10:00"));
}

describe("journal", () => {
  it("creates a record with rev 1 and the next seq, and reads it back", async () => {
    const { journal } = await setup();
    const w = await create(journal, "o1");
    expect(w.ok && w.draft.rev).toBe(1);
    expect(w.ok && w.draft.seq).toBe(1);
    expect((await journal.get("o1"))?.state.notes).toBe("");
  });

  it("lists unsynced drafts in the order they were first changed, and a later edit does not move a draft", async () => {
    const { journal } = await setup();
    await create(journal, "a");
    await create(journal, "b");
    await create(journal, "c");
    const edit = await journal.apply("a", 1, (cur) => ({ ...cur!, state: state("edited") }));
    expect(edit.ok && edit.draft.seq).toBe(1);
    expect((await journal.listUnsynced()).map((d) => d.orderId)).toEqual(["a", "b", "c"]);
  });

  it("gives a draft a new seq when it becomes unsynced again after being synced", async () => {
    const { journal } = await setup();
    await create(journal, "a");
    await create(journal, "b");
    const synced = await journal.markSynced("a", 1, { order: { id: "a", version: 1 } as unknown as Order, version: 1 });
    expect(synced.ok && synced.draft.syncState).toBe("synced");
    expect((await journal.listUnsynced()).map((d) => d.orderId)).toEqual(["b"]);
    const again = await journal.apply("a", 2, (cur) => ({ ...cur!, state: state("later"), syncState: "on_device" }));
    expect(again.ok && again.draft.seq).toBe(3);
    expect((await journal.listUnsynced()).map((d) => d.orderId)).toEqual(["b", "a"]);
  });

  it("refuses a write from a stale writer (two tabs) and keeps what is stored", async () => {
    const { journal } = await setup();
    await create(journal, "o1");
    const tabA = await journal.apply("o1", 1, (cur) => ({ ...cur!, state: state("from tab A") }));
    expect(tabA.ok).toBe(true);
    const tabB = await journal.apply("o1", 1, (cur) => ({ ...cur!, state: state("from tab B") }));
    expect(tabB.ok).toBe(false);
    if (!tabB.ok && tabB.reason === "rev_conflict") expect(tabB.stored?.state.notes).toBe("from tab A");
    expect((await journal.get("o1"))?.state.notes).toBe("from tab A");
    // a writer that thinks the record does not exist is refused as well
    const dup = await create(journal, "o1");
    expect(dup.ok).toBe(false);
  });

  it("keeps an unresolved request across a restart, with the same request id and payload", async () => {
    const { db, journal } = await setup();
    await create(journal, "o1");
    const inflight = { requestId: "req-1", expectedVersion: null, state: state() };
    await journal.apply("o1", 1, (cur) => ({ ...cur!, inflight, syncState: "syncing", tries: 2 }));
    const afterRestart = new Journal(db); // a new object over the same stored data
    const stored = await afterRestart.get("o1");
    expect(stored?.inflight).toEqual(inflight);
    expect(stored?.tries).toBe(2);
  });

  it("reports a storage failure without changing the previous record", async () => {
    const { storage, journal } = await setup();
    await create(journal, "o1", "original");
    storage.failWrites = true;
    const w = await journal.apply("o1", 1, (cur) => ({ ...cur!, state: state("lost") }));
    expect(w).toEqual({ ok: false, reason: "storage", message: STORAGE_FAILED_MESSAGE });
    storage.failWrites = false;
    expect((await journal.get("o1"))?.state.notes).toBe("original");
    expect((await journal.get("o1"))?.rev).toBe(1);
  });

  it("marks a draft synced with the server order as the new base", async () => {
    const { journal } = await setup();
    await create(journal, "o1");
    const order = { id: "o1", version: 4, order_number: 9 } as unknown as Order;
    const w = await journal.markSynced("o1", 1, { order, version: 4 });
    expect(w.ok && w.draft).toMatchObject({ syncState: "synced", baseVersion: 4, neverSent: false, inflight: null, reason: null, conflict: null });
    expect((await journal.get("o1"))?.serverOrder).toEqual(order);
  });

  it("discards only a draft that never reached the server", async () => {
    const { journal } = await setup();
    await create(journal, "never");
    await create(journal, "sent");
    await journal.markSynced("sent", 1, { order: null, version: 2 });
    expect(await journal.discardNeverSent("never")).toEqual({ ok: true });
    expect(await journal.get("never")).toBeUndefined();
    expect(await journal.discardNeverSent("sent")).toEqual({ ok: false, reason: "on_server" });
    expect(await journal.get("sent")).toBeDefined();
    expect(await journal.discardNeverSent("missing")).toEqual({ ok: true });
  });

  it("never uses the clock: the display time is stored but ordering follows the counter", async () => {
    const { journal } = await setup();
    await journal.apply("late", null, () => emptyDraft("late", state(), {}, "23:59"));
    await journal.apply("early", null, () => emptyDraft("early", state(), {}, "00:01"));
    expect((await journal.listUnsynced()).map((d: DraftRecord) => d.orderId)).toEqual(["late", "early"]);
  });
});
