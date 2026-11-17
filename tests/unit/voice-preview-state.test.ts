import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateFromMedicine } from "@/lib/voice/candidate";
import { canCreate, hasCorrections, mergeCorrections, normaliseSpoken, previewReducer, stateFromPreview, toOrderLines, type PreviewState } from "@/lib/voice/preview-state";
import { clearSession, loadSession, saveSession } from "@/lib/voice/session";
import type { Preview } from "@/lib/voice/types";
import { candidate, preview, previewLine } from "../helpers/voice";

// The preview state (research D9): every rule about what is still doubtful, and when "Create draft order" is allowed.

const matchedPanadol = previewLine("l0", "Panadol", {
  state: "matched",
  candidates: [candidate("p1", "Panadol", { is_exact: true, unit: "strip" })],
  productId: "p1",
  quantity: 20,
  unit: "strips",
});

const chooseBrufen = previewLine("l1", "Brufen", {
  state: "choose_one",
  candidates: [candidate("b1", "Brufen", { is_exact: true, unit: "box", strength: "400 mg" }), candidate("b2", "Brufen", { is_exact: true, unit: "box", strength: "200 mg" })],
  quantity: 10,
  unit: "boxes",
});

const unknownSyrup = previewLine("l2", "cough syrup", { state: "unknown", quantity: 5, unit: "bottles" });

const matchedStore: Preview["store"] = { spoken: "Al Madina Medical", state: "matched", candidates: [candidate("s1", "Al Madina Medical", { is_exact: true })], storeId: "s1" };

function open(lines = [matchedPanadol, chooseBrufen, unknownSyrup], store: Preview["store"] = matchedStore): PreviewState {
  return stateFromPreview(preview(lines, { store }));
}

describe("stateFromPreview", () => {
  it("makes the order id, the request id and every line id once, and starts matched lines as catalog and unknown ones as typed", () => {
    const state = open();
    expect(state.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set([state.orderId, state.requestId, ...state.lines.map((l) => l.lineId)]).size).toBe(5);
    expect(state.lines[0].choice).toEqual({ kind: "catalog", productId: "p1", name: "Panadol", unit: "strip" });
    expect(state.lines[1].choice).toBeNull();
    expect(state.lines[2].choice).toEqual({ kind: "typed" });
    expect(state.store).toMatchObject({ storeId: "s1", name: "Al Madina Medical" });
  });

  it("does not preselect a store that is not matched", () => {
    const state = open([matchedPanadol], { spoken: "Madina", state: "choose_one", candidates: [candidate("s1", "A"), candidate("s2", "B")], storeId: null });
    expect(state.store.storeId).toBeNull();
  });
});

describe("canCreate", () => {
  it("is not allowed while a choose-one line has no choice, and says which", () => {
    const result = canCreate(open());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Brufen/);
  });

  it("is allowed when every line is matched, chosen or typed with a valid quantity and unit", () => {
    let state = open();
    state = previewReducer(state, { type: "choose_candidate", key: "l1", candidate: state.lines[1].candidates[0] });
    expect(canCreate(state)).toEqual({ ok: true, reason: null });
  });

  it("is allowed when a choose-one line is turned into a typed line (None of these)", () => {
    let state = open();
    state = previewReducer(state, { type: "choose_typed", key: "l1" });
    expect(canCreate(state).ok).toBe(true);
  });

  it("needs a store", () => {
    const state = open([matchedPanadol], { spoken: null, state: "not_named", candidates: [], storeId: null });
    expect(canCreate(state)).toEqual({ ok: false, reason: "Choose the store for this order." });
    expect(canCreate(previewReducer(state, { type: "choose_store", store: { id: "s9", name: "Nimer" } })).ok).toBe(true);
  });

  it("needs at least one line", () => {
    expect(canCreate(open([])).ok).toBe(false);
  });

  it("is blocked by a doubtful quantity until the supplier enters a valid whole number", () => {
    let state = open([previewLine("l0", "Thing", { quantity: null, unit: "box", flags: ["missing_quantity"] })]);
    expect(canCreate(state).reason).toMatch(/quantity/i);
    state = previewReducer(state, { type: "set_quantity", key: "l0", quantity: 2.5 });
    expect(canCreate(state).ok).toBe(false);
    expect(state.lines[0].flags).toContain("quantity_not_whole");
    state = previewReducer(state, { type: "set_quantity", key: "l0", quantity: 12 });
    expect(canCreate(state).ok).toBe(true);
    expect(state.lines[0].flags).not.toContain("quantity_not_whole");
  });

  it("needs a unit for a typed line, and accepts one the supplier enters", () => {
    let state = open([previewLine("l0", "Thing", { quantity: 3, unit: null, flags: ["unit_not_heard"] })]);
    expect(canCreate(state).reason).toMatch(/unit/i);
    state = previewReducer(state, { type: "set_unit", key: "l0", unit: "  box " });
    expect(canCreate(state).ok).toBe(true);
    expect(state.lines[0].unit).toBe("box");
    expect(state.lines[0].flags).not.toContain("unit_not_heard");
  });
});

describe("previewReducer", () => {
  it("fills the unit from the chosen medicine when none was heard", () => {
    const state = open([previewLine("l1", "Brufen", { state: "choose_one", candidates: chooseBrufen.candidates, quantity: 10, unit: null, flags: ["unit_not_heard"] })]);
    const next = previewReducer(state, { type: "choose_candidate", key: "l1", candidate: chooseBrufen.candidates[0] });
    expect(next.lines[0].unit).toBe("box");
    expect(next.lines[0].flags).not.toContain("unit_not_heard");
    expect(next.lines[0].touched).toBe(true);
  });

  it("removes a line and adds a catalog or a typed line", () => {
    let state = open();
    state = previewReducer(state, { type: "remove_line", key: "l2" });
    expect(state.lines.map((l) => l.key)).toEqual(["l0", "l1"]);
    state = previewReducer(state, { type: "add_catalog_line", product: candidate("p9", "Augmentin", { unit: "box" }) });
    state = previewReducer(state, { type: "add_typed_line", name: "  New   thing " });
    expect(state.lines).toHaveLength(4);
    expect(state.lines[2]).toMatchObject({ spoken: "Augmentin", choice: { kind: "catalog", productId: "p9" }, quantity: null, unit: "box" });
    expect(state.lines[3]).toMatchObject({ spoken: "New thing", choice: { kind: "typed" }, quantity: null });
    expect(canCreate(state).ok).toBe(false);
  });

  it("refuses a 201st line and an empty typed name", () => {
    const full = open(Array.from({ length: 200 }, (_, i) => previewLine(`l${i}`, `M${i}`, { quantity: 1, unit: "x" })));
    expect(previewReducer(full, { type: "add_typed_line", name: "one more" }).lines).toHaveLength(200);
    expect(previewReducer(full, { type: "add_catalog_line", product: candidate("p", "X") }).lines).toHaveLength(200);
    expect(previewReducer(open(), { type: "add_typed_line", name: "   " }).lines).toHaveLength(3);
  });

  it("never calls anything: the same input gives the same output", () => {
    const state = open();
    expect(previewReducer(state, { type: "set_quantity", key: "l0", quantity: 7 })).toEqual(previewReducer(state, { type: "set_quantity", key: "l0", quantity: 7 }));
  });
});

describe("toOrderLines", () => {
  it("makes catalog lines with a product id and typed lines with the exact cleaned spoken text", () => {
    let state = open();
    state = previewReducer(state, { type: "choose_candidate", key: "l1", candidate: state.lines[1].candidates[1] });
    const lines = toOrderLines(state);
    expect(lines[0]).toEqual({ id: state.lines[0].lineId, product_id: "p1", name: null, quantity: 20, unit: "strips" });
    expect(lines[1]).toEqual({ id: state.lines[1].lineId, product_id: "b2", name: null, quantity: 10, unit: "boxes" });
    expect(lines[2]).toEqual({ id: state.lines[2].lineId, product_id: null, name: "cough syrup", quantity: 5, unit: "bottles" });
  });

  it("keeps the line ids the same on every call, so a retried create is the same request", () => {
    const state = open([matchedPanadol]);
    expect(toOrderLines(state)[0].id).toBe(toOrderLines(state)[0].id);
  });
});

// ---------------------------------------------------------------------------------------------------
// User Story 6: correct anything, then parse again. Every rule is a pure function; none of them calls the AI or saves.
// ---------------------------------------------------------------------------------------------------

describe("corrections that need no AI call", () => {
  it("edits the quantity, the unit and the medicine choice and marks the line as touched", () => {
    let state = open();
    state = previewReducer(state, { type: "set_quantity", key: "l0", quantity: 30 });
    state = previewReducer(state, { type: "set_unit", key: "l0", unit: "boxes" });
    state = previewReducer(state, { type: "choose_candidate", key: "l1", candidate: state.lines[1].candidates[1] });
    expect(state.lines[0]).toMatchObject({ quantity: 30, unit: "boxes", touched: true });
    expect(state.lines[1].choice).toMatchObject({ kind: "catalog", productId: "b2" });
    expect(state.lines[2].touched).toBe(false);
  });

  it("adds a typed line with the quantity and unit the supplier typed, flagging only what is missing", () => {
    const state = open([]);
    const full = previewReducer(state, { type: "add_typed_line", name: "  Odd   syrup ", quantity: 4, unit: " bottle " });
    expect(full.lines[0]).toMatchObject({ spoken: "Odd syrup", quantity: 4, unit: "bottle", flags: [], choice: { kind: "typed" }, touched: true });
    const noUnit = previewReducer(state, { type: "add_typed_line", name: "Thing", quantity: 4 });
    expect(noUnit.lines[0].flags).toEqual(["unit_not_heard"]);
    const bad = previewReducer(state, { type: "add_typed_line", name: "Thing", quantity: 2.5, unit: "box" });
    expect(bad.lines[0]).toMatchObject({ quantity: null, flags: ["quantity_not_whole"] });
    expect(canCreate(bad).ok).toBe(false);
  });

  it("says the limit instead of adding a 201st line, for every way of adding one", () => {
    const full = open(Array.from({ length: 200 }, (_, i) => previewLine(`l${i}`, `M${i}`, { quantity: 1, unit: "x" })));
    expect(previewReducer(full, { type: "add_typed_line", name: "one more", quantity: 1, unit: "x" })).toBe(full);
    expect(previewReducer(full, { type: "add_catalog_line", product: candidate("p", "X") })).toBe(full);
    expect(canCreate(full).ok).toBe(true);
  });

  it("remembers a removed line by its normalised spoken name and ignores a removal of a missing line", () => {
    let state = open();
    state = previewReducer(state, { type: "remove_line", key: "l2" });
    expect(state.removed).toEqual(["cough syrup"]);
    expect(previewReducer(state, { type: "remove_line", key: "nope" })).toBe(state);
    expect(normaliseSpoken("  Cough   SYRUP ")).toBe("cough syrup");
    expect(normaliseSpoken("پینا  ڈول")).toBe("پینا ڈول");
  });

  it("knows whether anything was corrected by hand", () => {
    const state = open();
    expect(hasCorrections(state)).toBe(false);
    expect(hasCorrections(previewReducer(state, { type: "set_quantity", key: "l0", quantity: 3 }))).toBe(true);
    expect(hasCorrections(previewReducer(state, { type: "remove_line", key: "l0" }))).toBe(true);
    expect(hasCorrections(previewReducer(state, { type: "add_typed_line", name: "x" }))).toBe(true);
    expect(hasCorrections(previewReducer(state, { type: "choose_store", store: { id: "s2", name: "Other" } }))).toBe(true);
  });
});

describe("mergeCorrections (parse again, keep my corrections)", () => {
  const freshOf = (lines: Array<ReturnType<typeof previewLine>>, store: Preview["store"] = matchedStore) => stateFromPreview(preview(lines, { store }));

  it("keeps every touched line exactly, replaces the untouched ones, and takes the new reading's ids", () => {
    let current = open();
    current = previewReducer(current, { type: "set_quantity", key: "l0", quantity: 99 });
    const keptLineId = current.lines[0].lineId;
    const fresh = freshOf([
      previewLine("n0", "Panadol", { state: "matched", candidates: [candidate("p1", "Panadol", { is_exact: true })], productId: "p1", quantity: 20, unit: "strips" }),
      previewLine("n1", "Calpol", { quantity: 2, unit: "bottle" }),
      previewLine("n2", "Disprin", { quantity: 6, unit: "strip" }),
    ]);
    const { state, overLimit } = mergeCorrections(current, fresh);
    expect(overLimit).toBe(0);
    // Panadol was corrected by hand: kept with 99 and its own line id; the new Panadol is dropped; the untouched Brufen
    // and cough syrup lines are replaced by the new reading's Calpol and Disprin.
    expect(state.lines.map((l) => l.spoken)).toEqual(["Panadol", "Calpol", "Disprin"]);
    expect(state.lines[0]).toMatchObject({ quantity: 99, lineId: keptLineId, touched: true });
    expect(state.orderId).toBe(fresh.orderId);
    expect(state.requestId).toBe(fresh.requestId);
    expect(state.orderId).not.toBe(current.orderId);
  });

  it("does not bring back a line the supplier removed, and keeps a store chosen by hand", () => {
    let current = open();
    current = previewReducer(current, { type: "remove_line", key: "l2" });
    current = previewReducer(current, { type: "choose_store", store: { id: "s9", name: "Nimer Medical" } });
    const fresh = freshOf([previewLine("n0", "  COUGH syrup ", { quantity: 5, unit: "bottles" }), previewLine("n1", "Calpol", { quantity: 2, unit: "bottle" })], {
      spoken: "Madina",
      state: "choose_one",
      candidates: [candidate("s1", "A"), candidate("s2", "B")],
      storeId: null,
    });
    const { state } = mergeCorrections(current, fresh);
    expect(state.lines.map((l) => l.spoken)).toEqual(["Calpol"]);
    expect(state.store).toMatchObject({ storeId: "s9", name: "Nimer Medical", touched: true });
    expect(state.removed).toEqual(["cough syrup"]);
  });

  it("takes the new store when the supplier did not choose one by hand", () => {
    const current = previewReducer(open(), { type: "set_quantity", key: "l0", quantity: 1 });
    const fresh = freshOf([previewLine("n0", "Calpol")], { spoken: "Shifa", state: "matched", candidates: [candidate("s2", "Al Shifa Pharmacy", { is_exact: true })], storeId: "s2" });
    expect(mergeCorrections(current, fresh).state.store).toMatchObject({ storeId: "s2", name: "Al Shifa Pharmacy" });
  });

  it("adds nothing past 200 lines and reports how many lines were left out", () => {
    let current = open(Array.from({ length: 199 }, (_, i) => previewLine(`l${i}`, `Old${i}`, { quantity: 1, unit: "x" })));
    for (let i = 0; i < 199; i += 1) current = previewReducer(current, { type: "set_quantity", key: `l${i}`, quantity: 2 });
    const fresh = freshOf([previewLine("n0", "New0"), previewLine("n1", "New1"), previewLine("n2", "New2")]);
    const { state, overLimit } = mergeCorrections(current, fresh);
    expect(state.lines).toHaveLength(200);
    expect(overLimit).toBe(2);
  });

  it("with no corrections there is nothing to keep, and a plain replacement is the new reading", () => {
    const current = open();
    expect(hasCorrections(current)).toBe(false);
    const fresh = freshOf([previewLine("n0", "Calpol")]);
    expect(mergeCorrections(current, fresh).state.lines.map((l) => l.spoken)).toEqual(["Calpol"]);
  });
});

describe("start over", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the unsent copy of the transcript and the preview in this tab", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
    saveSession({ transcript: "Panadol 20 strips", preview: open() });
    expect(loadSession()?.transcript).toBe("Panadol 20 strips");
    expect(loadSession()?.preview?.lines).toHaveLength(3);
    clearSession();
    expect(loadSession()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("never throws when storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(() => saveSession({ transcript: "x", preview: null })).not.toThrow();
    expect(() => clearSession()).not.toThrow();
    expect(loadSession()).toBeNull();
  });
});

describe("candidateFromMedicine", () => {
  it("keeps the identity and the description of a medicine and drops every price, cost and profit field", () => {
    const record = {
      id: "p1",
      name: "Panadol",
      unit: "strip",
      brand: "Panadol",
      strength: "500 mg",
      dosage_form: "tablet",
      manufacturer: "GSK",
      pack_size: "10",
      purchase_price: "80.00",
      selling_price: "125.50",
      mrp: "130.00",
      unit_gross_profit: "45.50",
      sku: "X1",
      version: 3,
    };
    const result = candidateFromMedicine(record);
    expect(result).toEqual({ id: "p1", name: "Panadol", unit: "strip", brand: "Panadol", strength: "500 mg", dosage_form: "tablet", manufacturer: "GSK", pack_size: "10", is_exact: false });
    expect(JSON.stringify(result)).not.toMatch(/price|mrp|cost|margin|profit|80\.00|125\.50|130\.00|45\.50/i);
  });

  it("fills missing optional fields with null", () => {
    expect(candidateFromMedicine({ id: "p2", name: "Brufen", unit: "box" })).toMatchObject({ brand: null, strength: null, dosage_form: null, manufacturer: null, pack_size: null });
  });
});

describe("mergeCorrections keys", () => {
  it("never lets a line of the new reading share a key or a line id with a kept line", () => {
    let current = open();
    current = previewReducer(current, { type: "set_quantity", key: "l1", quantity: 50 });
    // the new reading reuses the same keys l0, l1, l2 for different medicines
    const fresh = stateFromPreview(preview([previewLine("l0", "Calpol"), previewLine("l1", "Disprin"), previewLine("l2", "Augmentin")]));
    const { state } = mergeCorrections(current, fresh);
    const keys = state.lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(state.lines.map((l) => l.lineId)).size).toBe(state.lines.length);
    // a correction on a new line changes only that line
    const changed = previewReducer(state, { type: "set_quantity", key: state.lines[1].key, quantity: 7 });
    expect(changed.lines.filter((l) => l.quantity === 7)).toHaveLength(1);
    expect(changed.lines[0].quantity).toBe(50);
  });
});
