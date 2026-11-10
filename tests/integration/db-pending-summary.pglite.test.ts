import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbCancel } from "../helpers/orders-db";
import { createTenant, createTestDb, type Tenant } from "../helpers/pglite";
import { linkBody, priceBody, registerBody } from "../helpers/pending";
import { catalogLine, createPendingOrder, dbLink, dbPreview, dbPriceApply, dbPricesList, dbRegister, dbSummary, dbTypedGroups, insertMedicine, insertStore, refetch, typedLine, type PriceItem, type TypedGroupsResult } from "../helpers/pending-db";

// The counts on Home and the two lists (pending_summary, pending_typed_groups, pending_prices_list) on a real
// PostgreSQL engine (PGlite): the counts always equal what the lists show (SC-007) and follow every change.

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** Every scenario gets its own business so that one scenario's rows never show up in another's. */
async function business(): Promise<{ t: Tenant; storeA: string; storeB: string }> {
  counter += 1;
  const t = await createTenant(db, `sum${counter}`);
  return { t, storeA: await insertStore(db, t.businessId, "Alpha Store"), storeB: await insertStore(db, t.businessId, "Bravo Store") };
}

async function allTyped(userId: string, q: string | null = null): Promise<TypedGroupsResult["items"]> {
  const items: TypedGroupsResult["items"] = [];
  let offset = 0;
  for (;;) {
    const page = await dbTypedGroups(db, userId, q, 100, offset);
    items.push(...page.items);
    if (page.next_offset === null) return items;
    offset = page.next_offset;
  }
}

async function allPrices(userId: string, onlyWaiting = false): Promise<PriceItem[]> {
  const items: PriceItem[] = [];
  let offset = 0;
  for (;;) {
    const page = await dbPricesList(db, userId, null, onlyWaiting, 100, offset);
    items.push(...page.items);
    if (page.next_offset === null) return items;
    offset = page.next_offset;
  }
}

describe("pending_summary", () => {
  it("counts typed lines on draft and confirmed orders only, the typed groups by normalised text, and nothing of another business", async () => {
    const { t, storeA, storeB } = await business();
    const other = await business();
    await createPendingOrder(db, t.userId, storeA, [typedLine("Noran 20mg", 1), typedLine("NORAN   20MG", 2), typedLine("Zed", 3)], { confirm: true });
    await createPendingOrder(db, t.userId, storeB, [typedLine("noran 20mg", 4)]); // a draft
    const gone = await createPendingOrder(db, t.userId, storeA, [typedLine("Cancelled Only", 1)], { confirm: true });
    await dbCancel(db, t.userId, gone.id, gone.order.version, "test");
    const withRemoved = await createPendingOrder(db, t.userId, storeA, [typedLine("Removed Only", 1), typedLine("Zed", 1)]);
    await db.query(`update public.order_lines set removed_at = now() where id = $1`, [withRemoved.lineIds[0]]);
    await createPendingOrder(db, other.t.userId, other.storeA, [typedLine("Foreign typed", 1), typedLine("Foreign two", 1)], { confirm: true });
    await insertMedicine(db, other.t.businessId, { name: "Foreign unpriced", unit: "strip" });

    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 5, typed_groups: 2, price_items: 0, price_items_with_waiting_lines: 0, lines_waiting: 0 });
    expect(await dbSummary(db, other.t.userId)).toMatchObject({ typed_lines: 2, typed_groups: 2, price_items: 1, price_items_with_waiting_lines: 0 });
  });

  it("counts unpriced active medicines and priced ones that still have waiting lines, with the waiting lines", async () => {
    const { t, storeA } = await business();
    const unpriced = await insertMedicine(db, t.businessId, { name: "Unpriced", unit: "strip" });
    const late = await insertMedicine(db, t.businessId, { name: "Late", unit: "strip" });
    await insertMedicine(db, t.businessId, { name: "Quiet", unit: "strip", selling_price: "10.00" });
    await insertMedicine(db, t.businessId, { name: "Inactive", unit: "strip", is_active: false });
    await createPendingOrder(db, t.userId, storeA, [catalogLine(unpriced, 1, "strip"), catalogLine(unpriced, 2, "strip"), catalogLine(late, 3, "strip")], { confirm: true });
    await createPendingOrder(db, t.userId, storeA, [catalogLine(unpriced, 9, "strip")]); // a draft does not wait
    await db.query(`update public.products set selling_price = '20.00' where id = $1`, [late]);

    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 0, typed_groups: 0, price_items: 2, price_items_with_waiting_lines: 2, lines_waiting: 3 });
    const all = await allPrices(t.userId);
    expect(all.map((i) => i.name).sort()).toEqual(["Late", "Unpriced"]);
  });

  it("price_items equals the length of the unfiltered list and the typed groups equal the groups listed (SC-007)", async () => {
    const { t, storeA, storeB } = await business();
    const waiting = await insertMedicine(db, t.businessId, { name: "Waiting", unit: "strip" });
    for (let i = 0; i < 7; i += 1) await insertMedicine(db, t.businessId, { name: `Bare ${i}`, unit: "strip" });
    await createPendingOrder(db, t.userId, storeA, [catalogLine(waiting, 1, "strip"), ...Array.from({ length: 4 }, (_, i) => typedLine(`Typed ${i}`, 1))], { confirm: true });
    await createPendingOrder(db, t.userId, storeB, [typedLine("typed 1", 2), typedLine("Typed 9", 1)]);

    const summary = await dbSummary(db, t.userId);
    const prices = await allPrices(t.userId);
    const waitingOnly = await allPrices(t.userId, true);
    const groups = await allTyped(t.userId);
    expect(summary.price_items).toBe(prices.length);
    expect(summary.price_items_with_waiting_lines).toBe(waitingOnly.length);
    expect(waitingOnly.length).toBeLessThanOrEqual(prices.length); // a subset
    expect(summary.typed_groups).toBe(groups.length);
    expect(summary.typed_lines).toBe(groups.reduce((n, g) => n + g.line_count, 0));
    expect(summary.lines_waiting).toBe(prices.reduce((n, i) => n + i.lines_waiting, 0));
    expect(summary).toMatchObject({ typed_groups: 5, typed_lines: 6, price_items: 8, price_items_with_waiting_lines: 1, lines_waiting: 1 });
  });

  it("changes correctly after a register, a link and a price fill", async () => {
    const { t, storeA, storeB } = await business();
    const o1 = await createPendingOrder(db, t.userId, storeA, [typedLine("Noran A", 2), typedLine("noran  a", 3)], { confirm: true });
    await createPendingOrder(db, t.userId, storeB, [typedLine("Zed B", 1)]);
    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 3, typed_groups: 2, price_items: 0, price_items_with_waiting_lines: 0, lines_waiting: 0 });

    const reg = await dbRegister(db, t.userId, o1.id, o1.lineIds[0], registerBody(o1.order.version, { name: "Noran A" }));
    expect(reg.done).toBe(true);
    // the new medicine has no price and its confirmed line waits for one
    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 2, typed_groups: 2, price_items: 1, price_items_with_waiting_lines: 1, lines_waiting: 1 });

    const version = (await refetch(db, t.userId, o1.id)).version;
    const link = await dbLink(db, t.userId, o1.id, o1.lineIds[1], linkBody(version, reg.product!.id));
    expect(link.done).toBe(true);
    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 1, typed_groups: 1, price_items: 1, price_items_with_waiting_lines: 1, lines_waiting: 2 });

    const review = await dbPreview(db, t.userId, reg.product!.id, "30");
    const fill = await dbPriceApply(db, t.userId, reg.product!.id, priceBody("30", review.lines!.map((l) => l.line_id)));
    expect(fill).toMatchObject({ done: true, filled_count: 2 });
    expect(await dbSummary(db, t.userId)).toEqual({ typed_lines: 1, typed_groups: 1, price_items: 0, price_items_with_waiting_lines: 0, lines_waiting: 0 });
  });

  it("is refused for a user without a business", async () => {
    const noBiz = await db.query<{ id: string }>(`insert into auth.users (email) values ('nobiz-sum@example.test') returning id`);
    await expect(dbSummary(db, noBiz.rows[0].id)).rejects.toThrow(/no_business/);
  });
});

describe("pending_typed_groups", () => {
  it("groups by normalised text, shows the first typed spelling and every line with its store, order, status, quantity and unit", async () => {
    const { t, storeA, storeB } = await business();
    const o1 = await createPendingOrder(db, t.userId, storeA, [typedLine("Noran 20mg", 4, "strip"), typedLine("Zed", 1, "box")], { confirm: true });
    const o2 = await createPendingOrder(db, t.userId, storeB, [typedLine("NORAN   20MG", 7, "box")]);
    const gone = await createPendingOrder(db, t.userId, storeA, [typedLine("Noran 20mg", 1)], { confirm: true });
    await dbCancel(db, t.userId, gone.id, gone.order.version, "test");

    const page = await dbTypedGroups(db, t.userId);
    expect(page.next_offset).toBeNull();
    expect(page.items.map((g) => g.typed_text)).toEqual(["Noran 20mg", "Zed"]); // the first spelling, sorted ignoring case
    const noran = page.items[0];
    expect(noran.line_count).toBe(2);
    expect(noran.lines).toEqual([
      expect.objectContaining({ line_id: o1.lineIds[0], order_id: o1.id, order_number: o1.order.order_number, order_status: "confirmed", store_name: "Alpha Store", typed_text: "Noran 20mg", quantity: 4, unit: "strip" }),
      expect.objectContaining({ line_id: o2.lineIds[0], order_id: o2.id, order_number: o2.order.order_number, order_status: "draft", store_name: "Bravo Store", typed_text: "NORAN 20MG", quantity: 7, unit: "box" }), // saving an order already collapses extra spaces
    ]);
  });

  it("filters by words (all must appear), ignoring case", async () => {
    const { t, storeA } = await business();
    await createPendingOrder(db, t.userId, storeA, [typedLine("Noran 20mg cap", 1), typedLine("Noran 40mg cap", 1), typedLine("Zed syrup", 1)]);
    expect((await dbTypedGroups(db, t.userId, "zed")).items.map((g) => g.typed_text)).toEqual(["Zed syrup"]);
    expect((await dbTypedGroups(db, t.userId, "NORAN CAP")).items.map((g) => g.typed_text)).toEqual(["Noran 20mg cap", "Noran 40mg cap"]);
    expect((await dbTypedGroups(db, t.userId, "noran 40")).items.map((g) => g.typed_text)).toEqual(["Noran 40mg cap"]);
    expect((await dbTypedGroups(db, t.userId, "nothing like this")).items).toEqual([]);
    expect((await dbTypedGroups(db, t.userId, "50%")).items).toEqual([]); // % is text, not a wildcard
  });

  it("pages with limit and offset and reports where the next page starts", async () => {
    const { t, storeA } = await business();
    await createPendingOrder(db, t.userId, storeA, ["a", "b", "c", "d", "e"].map((x) => typedLine(`Item ${x}`, 1)));
    const p1 = await dbTypedGroups(db, t.userId, null, 2, 0);
    const p2 = await dbTypedGroups(db, t.userId, null, 2, p1.next_offset ?? 0);
    const p3 = await dbTypedGroups(db, t.userId, null, 2, p2.next_offset ?? 0);
    expect(p1.next_offset).toBe(2);
    expect(p2.next_offset).toBe(4);
    expect(p3.next_offset).toBeNull();
    expect([...p1.items, ...p2.items, ...p3.items].map((g) => g.typed_text)).toEqual(["Item a", "Item b", "Item c", "Item d", "Item e"]);
  });

  it("never lists another business's lines", async () => {
    const { t, storeA } = await business();
    const other = await business();
    await createPendingOrder(db, t.userId, storeA, [typedLine("Mine", 1)]);
    await createPendingOrder(db, other.t.userId, other.storeA, [typedLine("Theirs", 1)]);
    expect((await dbTypedGroups(db, t.userId)).items.map((g) => g.typed_text)).toEqual(["Mine"]);
  });
});
