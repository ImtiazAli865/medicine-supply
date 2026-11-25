import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_EVERYWHERE, forbiddenWordsIn, NAMES_ONLY, PAYMENT_FILES } from "../helpers/offline-guard";

// The narrowed offline guard (Module 011, T006): "payment" is allowed only in the named payment files, and every other
// forbidden word stays forbidden everywhere, payment files included. The tests plant each word and expect the guard to
// catch it, so the rule cannot be loosened by accident.

const PAYMENT_FILE = path.join("src", "lib", "device", "payments.ts");
const OTHER_FILE = path.join("src", "lib", "device", "cache.ts");

const PLANTED: Array<[string, string]> = [
  ["balance", "const shown = balance;"],
  ["invoice", "const x = invoice.total;"],
  ["ledger", "await ledger.add();"],
  ["cost", "const c = cost;"],
  ["profit", "const p = profit;"],
  ["margin", "const m = margin;"],
  ["mrp", "const m = mrp;"],
  ["purchase_price", "const p = purchase_price;"],
  ["snapshot_", "const s = snapshot_taken_at;"],
];

describe("the narrowed offline guard", () => {
  it("lists the payment files and the names-only files, all under src", () => {
    expect(PAYMENT_FILES.size).toBeGreaterThan(5);
    for (const f of [...PAYMENT_FILES, ...NAMES_ONLY]) expect(f.startsWith("src")).toBe(true);
  });

  it("lets a payment file contain the word payment", () => {
    expect(forbiddenWordsIn(PAYMENT_FILE, "export function newPayment() { return payment; }")).toEqual([]);
  });

  it("refuses the word payment in any other device file", () => {
    expect(forbiddenWordsIn(OTHER_FILE, "const payment = 1;")).toEqual(["payment"]);
    expect(forbiddenWordsIn(path.join("src", "lib", "device", "journal.ts"), "// no\nconst x = recordPayment();")).toEqual(["payment"]);
  });

  for (const [word, line] of PLANTED) {
    it(`still refuses the word ${word} in a payment file`, () => {
      expect(forbiddenWordsIn(PAYMENT_FILE, line)).toContain(word);
    });
    it(`still refuses the word ${word} in any other device file`, () => {
      expect(forbiddenWordsIn(OTHER_FILE, line)).toContain(word);
    });
  }

  it("catches several planted words at once and each in a different case", () => {
    expect(forbiddenWordsIn(PAYMENT_FILE, "const a = Balance + INVOICE + Ledger;")).toEqual(["balance", "invoice", "ledger"]);
  });

  it("does not flag words that merely contain a forbidden word as part of another word", () => {
    // "cost" and "balance" are whole words; "costume" or "rebalanced" are not flagged by the word-boundary rules.
    expect(forbiddenWordsIn(PAYMENT_FILE, "const costume = 1; const rebalanced = 2;")).toEqual([]);
  });

  it("exempts only the three files that name the words", () => {
    for (const f of NAMES_ONLY) expect(forbiddenWordsIn(f, "balance invoice ledger payment cost profit")).toEqual([]);
    expect(forbiddenWordsIn(path.join("src", "lib", "device", "sync-center.ts"), "balance")).toEqual(["balance"]);
  });

  it("has a forbidden-everywhere pattern that never contains the word payment", () => {
    expect("payment".match(FORBIDDEN_EVERYWHERE)).toBeNull();
  });
});
