import { describe, expect, it } from "vitest";
import { initialListState, listReducer, MAX_MEDICINES, needsServerSearch, type ListState } from "@/lib/orders/fast-list";
import type { SlimMedicine } from "@/lib/orders/fast-types";

function med(id: string): SlimMedicine {
  return { id, name: `Med ${id}`, unit: "strip", brand: null, generic_name: null, strength: null, dosage_form: null, manufacturer: null, pack_size: null, sku: null, selling_price: null };
}
const many = (from: number, count: number) => Array.from({ length: count }, (_, i) => med(String(from + i)));

describe("medicine list reducer", () => {
  it("appends pages in order and becomes ready when the last page arrives", () => {
    let s: ListState = listReducer(initialListState(1), { type: "start", loadId: 1 });
    s = listReducer(s, { type: "page", loadId: 1, items: many(0, 3), next: "3" });
    expect(s.status).toBe("loading");
    expect(s.next).toBe("3");
    s = listReducer(s, { type: "page", loadId: 1, items: many(3, 2), next: null });
    expect(s.status).toBe("ready");
    expect(s.rows.map((r) => r.medicine.id)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("drops a row whose id is already loaded (the offset cursor can repeat a row)", () => {
    let s = initialListState(1);
    s = listReducer(s, { type: "page", loadId: 1, items: many(0, 3), next: "3" });
    s = listReducer(s, { type: "page", loadId: 1, items: [med("2"), med("3")], next: null });
    expect(s.rows.map((r) => r.medicine.id)).toEqual(["0", "1", "2", "3"]);
  });

  it("stops with too_large above 6,000 rows and frees the rows", () => {
    let s = initialListState(1);
    for (let i = 0; i < MAX_MEDICINES / 1000; i += 1) s = listReducer(s, { type: "page", loadId: 1, items: many(i * 1000, 1000), next: String((i + 1) * 1000) });
    expect(s.status).toBe("loading"); // exactly 6,000 is still allowed
    s = listReducer(s, { type: "page", loadId: 1, items: many(6000, 1), next: "6001" });
    expect(s.status).toBe("too_large");
    expect(s.rows).toEqual([]);
    expect(s.next).toBeNull();
    expect(needsServerSearch(s)).toBe(true);
  });

  it("keeps the rows already loaded on an error, but never searches a partial list on the device", () => {
    let s = initialListState(1);
    s = listReducer(s, { type: "page", loadId: 1, items: many(0, 2), next: "2" });
    s = listReducer(s, { type: "fail", loadId: 1, message: "Network down" });
    expect(s.status).toBe("error");
    expect(s.error).toBe("Network down");
    expect(s.rows).toHaveLength(2);
    expect(needsServerSearch(s)).toBe(true);
  });

  it("uses the device only when the list is complete", () => {
    expect(needsServerSearch(initialListState(1))).toBe(true);
    const ready = listReducer(initialListState(1), { type: "page", loadId: 1, items: many(0, 1), next: null });
    expect(needsServerSearch(ready)).toBe(false);
  });

  it("starts over on a refresh and ignores answers of an older load", () => {
    let s = listReducer(initialListState(1), { type: "page", loadId: 1, items: many(0, 2), next: null });
    s = listReducer(s, { type: "start", loadId: 2 });
    expect(s).toMatchObject({ status: "loading", rows: [], loadId: 2 });
    const stale = listReducer(s, { type: "page", loadId: 1, items: many(0, 5), next: null });
    expect(stale).toBe(s);
    expect(listReducer(s, { type: "fail", loadId: 1, message: "old" })).toBe(s);
  });

  it("ignores a page that arrives after the list is already ready or failed", () => {
    const ready = listReducer(initialListState(1), { type: "page", loadId: 1, items: many(0, 1), next: null });
    expect(listReducer(ready, { type: "page", loadId: 1, items: many(5, 1), next: null })).toBe(ready);
  });
});
