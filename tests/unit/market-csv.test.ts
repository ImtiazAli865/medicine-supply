import { describe, expect, it } from "vitest";
import { CSV_HEADER, csvCell, toCsv } from "@/lib/market/csv";
import type { MarketList, MarketRow } from "@/lib/market/types";

const row = (overrides: Partial<MarketRow> = {}): MarketRow => ({
  key: "p:strip",
  product_id: "p",
  name: "Panadol",
  typed_name: null,
  strength: "500 mg",
  dosage_form: "tablet",
  pack_size: "10",
  manufacturer: "GSK",
  unit: "strip",
  total_requested: 45,
  shown_requested: 45,
  purchased: 30,
  remaining: 15,
  extra: 0,
  status: "partly_bought",
  can_record: true,
  stores: [
    { store_id: "s1", store_name: "Al Madina", quantity: 20 },
    { store_id: "s2", store_name: "Shah Medical", quantity: 25 },
  ],
  ...overrides,
});

const list = (rows: MarketRow[], typed: MarketRow[] = []): MarketList => ({
  date: "2026-11-12",
  generated_at: "2026-11-12T10:00:00.000Z",
  business_name: "Test business",
  stores: [],
  rows,
  typed_rows: typed,
  totals: { requested: 0, purchased: 0, remaining: 0, rows: rows.length, typed_rows: typed.length },
  truncated: false,
});

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises the formula start of %j", (text) => {
    expect(csvCell(text).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("does not touch ordinary text that merely contains these characters", () => {
    expect(csvCell("5-FU 500mg")).toBe("5-FU 500mg");
    expect(csvCell("Vitamin B+C")).toBe("Vitamin B+C");
  });

  it("writes numbers as they are, never with an apostrophe", () => {
    expect(csvCell(45)).toBe("45");
    expect(csvCell(0)).toBe("0");
  });
});

describe("toCsv", () => {
  it("starts with a byte order mark and a header that has no cost or price column", () => {
    const csv = toCsv(list([row()]));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)[0]).toBe(CSV_HEADER.join(","));
    expect(CSV_HEADER.join(" ")).not.toMatch(/price|cost|mrp|margin|profit/i);
  });

  it("writes one line per medicine and store with the medicine's totals", () => {
    const rowsOut = lines(toCsv(list([row()])));
    expect(rowsOut).toHaveLength(3);
    expect(rowsOut[1]).toBe("Panadol,500 mg,tablet,10,strip,Al Madina,20,45,30,15,Partly bought,registered");
    expect(rowsOut[2]).toBe("Panadol,500 mg,tablet,10,strip,Shah Medical,25,45,30,15,Partly bought,registered");
  });

  it("marks typed entries as unregistered and writes their typed text", () => {
    const typed = row({ product_id: null, name: null, typed_name: "Noran 20mg cap", strength: null, dosage_form: null, pack_size: null, purchased: 0, remaining: 10, total_requested: 10, status: "not_bought", can_record: false, stores: [{ store_id: "s1", store_name: "Al Madina", quantity: 10 }] });
    const out = lines(toCsv(list([], [typed])));
    expect(out[1]).toBe("Noran 20mg cap,,,,strip,Al Madina,10,10,0,10,Not bought,unregistered");
  });

  it("neutralises a medicine or store name that starts like a formula", () => {
    const out = lines(toCsv(list([row({ name: "=1+1", stores: [{ store_id: "s1", store_name: "@evil", quantity: 1 }] })])));
    expect(out[1].startsWith("'=1+1,")).toBe(true);
    expect(out[1]).toContain(",'@evil,");
  });

  it("writes only the selected stores' lines (the row already holds them)", () => {
    const only = row({ shown_requested: 20, stores: [{ store_id: "s1", store_name: "Al Madina", quantity: 20 }] });
    expect(lines(toCsv(list([only])))).toHaveLength(2);
  });

  it("gives just the header for an empty list", () => {
    expect(lines(toCsv(list([])))).toEqual([CSV_HEADER.join(",")]);
  });
});
