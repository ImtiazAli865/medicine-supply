import { describe, expect, it } from "vitest";
import { availableChoices, conflictFrom, describeChoice, diffLines, keepBothDraft, kindOfRefusal, kindOfServerConflict, serverState } from "@/lib/device/conflict";
import { emptyDraft } from "@/lib/device/journal";
import type { EditorState, LineInfo } from "@/lib/orders/editor-state";
import type { Order } from "@/lib/orders/types";

const info = (name: string, typed = false): LineInfo => ({ name, typed_name: null, strength: null, dosage_form: null, pack_size: null, manufacturer: null, selling_price: null, price_basis: "none", typed });

function server(status: Order["status"], lines: Array<{ id: string; product_id: string | null; name: string; quantity: number; unit: string }>, version = 5): Order {
  return {
    id: "o1",
    order_number: 12,
    status,
    version,
    store: { id: "s1", name: "Alpha", is_active: true },
    notes: null,
    lines: lines.map((l, i) => ({ ...l, position: i + 1 })),
  } as unknown as Order;
}

const phone: EditorState = {
  storeId: "s1",
  notes: "",
  lines: [
    { id: "l1", product_id: "p1", name: null, quantity: 10, unit: "strip" },
    { id: "l2", product_id: null, name: "Typed X", quantity: 2, unit: "box" },
  ],
};
const phoneInfo = { l1: info("Panadol"), l2: info("Typed X", true) };

describe("conflict kinds and choices", () => {
  it("classifies a server answer: a draft is a plain change, a confirmed or cancelled order is not editable, no order is missing", () => {
    expect(kindOfServerConflict(server("draft", []))).toBe("changed");
    expect(kindOfServerConflict(server("confirmed", []))).toBe("not_editable");
    expect(kindOfServerConflict(server("cancelled", []))).toBe("not_editable");
    expect(kindOfServerConflict(null)).toBe("missing");
  });

  it("classifies a refusal by its fields: lines hold the order for a medicine, a store holds it for the store", () => {
    expect(kindOfRefusal({ lines: "x" })).toBe("line_problem");
    expect(kindOfRefusal({ store_id: "x" })).toBe("store_problem");
    expect(kindOfRefusal({ other: "x" })).toBeNull();
    expect(kindOfRefusal(undefined)).toBeNull();
  });

  it("offers keep-phone only when the server order is still an editable draft", () => {
    expect(availableChoices(conflictFrom("changed", server("draft", []), "m"))).toEqual(["keep_phone", "keep_server", "keep_both"]);
    expect(availableChoices(conflictFrom("not_editable", server("confirmed", []), "m"))).toEqual(["keep_server", "keep_both"]);
    expect(availableChoices(conflictFrom("changed", server("cancelled", []), "m"))).toEqual(["keep_server", "keep_both"]);
    expect(availableChoices(conflictFrom("missing", null, "m"))).toEqual(["keep_both"]);
  });

  it("offers no replace choice for a held line or store: the supplier decides about that medicine or store instead", () => {
    expect(availableChoices(conflictFrom("line_problem", null, "m"))).toEqual([]);
    expect(availableChoices(conflictFrom("store_problem", null, "m"))).toEqual([]);
  });
});

describe("what each choice will change", () => {
  const conflict = conflictFrom("changed", server("draft", [{ id: "l9", product_id: "p9", name: "Brufen", quantity: 4, unit: "strip" }], 7), "m");

  it("names what replaces what and what is lost, with the counts, for each choice", () => {
    const keepPhone = describeChoice("keep_phone", phone, conflict);
    expect(keepPhone).toContain("server order (1 line, version 7) will be replaced");
    expect(keepPhone).toContain("order on this phone (2 lines)");
    const keepServer = describeChoice("keep_server", phone, conflict);
    expect(keepServer).toContain("phone's changes will be lost");
    expect(keepServer).toContain("(2 lines) will be deleted from this phone");
    const keepBoth = describeChoice("keep_both", phone, conflict);
    expect(keepBoth).toContain("new separate draft");
    expect(keepBoth).toContain("server's order stays as it is");
  });
});

describe("the side-by-side view", () => {
  it("matches lines by id and then by medicine, and marks every difference", () => {
    const s = server("draft", [
      { id: "l1", product_id: "p1", name: "Panadol", quantity: 6, unit: "strip" },
      { id: "other-id", product_id: null, name: "Typed X", quantity: 2, unit: "box" },
      { id: "l9", product_id: "p9", name: "Brufen", quantity: 4, unit: "strip" },
    ]);
    const rows = diffLines(phone, phoneInfo, s);
    expect(rows.map((r) => [r.key, r.differs])).toEqual([
      ["l1", true], // quantity 10 on the phone, 6 on the server
      ["l2", true], // typed line: not matched by id, so it is on the phone side only
      ["other-id", true], // the server's typed line, on the server side only
      ["l9", true], // only on the server
    ]);
    expect(rows[0]).toMatchObject({ phone: { name: "Panadol", quantity: 10 }, server: { quantity: 6 } });
  });

  it("shows no difference for identical lines and the whole phone side when there is no server order", () => {
    const same = server("draft", [{ id: "l1", product_id: "p1", name: "Panadol", quantity: 10, unit: "strip" }]);
    const rows = diffLines({ ...phone, lines: [phone.lines[0]!] }, phoneInfo, same);
    expect(rows).toEqual([{ key: "l1", phone: { name: "Panadol", quantity: 10, unit: "strip" }, server: { name: "Panadol", quantity: 10, unit: "strip" }, differs: false }]);
    const none = diffLines(phone, phoneInfo, null);
    expect(none.every((r) => r.server === null && r.differs)).toBe(true);
  });
});

describe("keep both", () => {
  it("makes a new draft with a new order id and new line ids, the same store and lines, never sent", () => {
    const record = { ...emptyDraft("o1", phone, phoneInfo, "10:00"), baseVersion: 3, neverSent: false, rev: 4, seq: 9 };
    let n = 0;
    const copy = keepBothDraft(record, "o2", () => `new-${++n}`, "10:05");
    expect(copy).toMatchObject({ orderId: "o2", rev: 0, baseVersion: null, neverSent: true, syncState: "on_device", inflight: null, serverOrder: null, conflict: null });
    expect(copy.state.storeId).toBe("s1");
    expect(copy.state.lines.map((l) => [l.id, l.product_id, l.name, l.quantity, l.unit])).toEqual([
      ["new-1", "p1", null, 10, "strip"],
      ["new-2", null, "Typed X", 2, "box"],
    ]);
    expect(Object.keys(copy.lineInfo).sort()).toEqual(["new-1", "new-2"]);
    expect(copy.lineInfo["new-2"]).toMatchObject({ name: "Typed X", typed: true });
    // the original record is untouched
    expect(record.state.lines.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("turns the server order into the screen state for keep-server", () => {
    const s = server("draft", [{ id: "l9", product_id: "p9", name: "Brufen", quantity: 4, unit: "strip" }]);
    expect(serverState(s).lines).toEqual([{ id: "l9", product_id: "p9", name: null, quantity: 4, unit: "strip" }]);
  });
});
