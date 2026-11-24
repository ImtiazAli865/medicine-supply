import { describe, expect, it } from "vitest";
import { balancesCsv, costMissingCsv, medicinesCsv, purchasesCsv, salesCsv, storesCsv } from "@/lib/reports/csv";
import type { CostMissingReport, MedicineReport, ProfitFigure, PurchaseReport, SalesReport, StoreReport } from "@/lib/reports/types";

// The six report files (spec FR-020, SC-009): rows and totals as on the screen, the Estimate, Incomplete and "not
// available" markers kept, money and counts as numbers (a loss stays a number), names as text.

const PERIOD = { from: "2026-11-01", to: "2026-11-25", group: "day" as const, generated_at: "2026-11-25T08:00:00Z" };
const complete = (cost: string, profit: string | null, covered = "100.00"): ProfitFigure => ({ cost, covered_sales: covered, profit, missing_lines: 0, missing_sales: "0.00", status: "complete" });
const incomplete = (cost: string, profit: string | null, missing: number): ProfitFigure => ({ cost, covered_sales: "50.00", profit, missing_lines: missing, missing_sales: "75.00", status: "incomplete" });
const lines = (file: string) => file.split("\r\n").filter((l) => l !== "");

describe("sales CSV", () => {
  const report: SalesReport = {
    period: PERIOD,
    totals: { sales: "225.00", invoices: 3, lines: 4, quantity: 9 },
    estimated: complete("200.00", "25.00", "225.00"),
    realized: incomplete("60.00", "-10.00", 3),
    excluded: { cancelled_invoices: 1, draft_invoices: 2 },
    series: [
      { bucket_start: "2026-11-23", bucket_end: "2026-11-23", partial: false, sales: "100.00", invoices: 1, estimated: complete("90.00", "10.00"), realized: incomplete("60.00", "-10.00", 1) },
      { bucket_start: "2026-11-24", bucket_end: "2026-11-24", partial: false, sales: "125.00", invoices: 2, estimated: complete("110.00", "15.00", "125.00"), realized: incomplete("0.00", null, 2) },
    ],
  };
  const file = lines(salesCsv(report));

  it("has the period on every row, one row per bucket and a TOTAL row last", () => {
    expect(file).toHaveLength(4);
    expect(file[0]).toContain("Period,Bucket start,Bucket end,Partial bucket,Sales,Invoices,Estimated cost,Estimated profit");
    expect(file[1]).toBe('2026-11-01 to 2026-11-25,2026-11-23,2026-11-23,No,100.00,1,90.00,10.00,Estimate,0,60.00,-10.00,"Realized, incomplete: 1 line without cost",1,');
    expect(file[3].startsWith("2026-11-01 to 2026-11-25,TOTAL,,,225.00,3,")).toBe(true);
  });

  it("keeps the markers: Estimate, Realized incomplete with the count, and not available for a missing profit", () => {
    expect(file[3]).toContain('"Realized, incomplete: 3 lines without cost"');
    expect(file[3]).toContain("1 cancelled invoice and 2 draft invoices are not counted.");
    expect(file[2]).toContain("Realized: not available (no line has a cost)");
    expect(file[2]).toMatch(/,0\.00,,Realized: not available/); // the profit cell is empty, not 0.00
  });

  it("leaves a loss as a number, not as text with an apostrophe", () => {
    expect(file[1]).toContain(",-10.00,");
    expect(file.join("\n")).not.toContain("'-10.00");
  });
});

describe("purchases CSV", () => {
  const report: PurchaseReport = {
    period: PERIOD,
    totals: { cost: "649.99", entries: 4, entries_with_cost: 3, entries_without_cost: 1, quantity_without_cost: 7, cancelled_entries_left_out: 1, status: "incomplete" },
    series: [{ bucket_start: "2026-11-02", bucket_end: "2026-11-02", partial: false, cost: "99.99", entries: 2, entries_without_cost: 1 }],
  };

  it("lists the buckets, then a TOTAL row that says Incomplete and what was left out", () => {
    const file = lines(purchasesCsv(report));
    expect(file[1]).toBe("2026-11-01 to 2026-11-25,2026-11-02,2026-11-02,No,99.99,2,1,Incomplete,");
    expect(file[2]).toContain("TOTAL,,,649.99,4,1,Incomplete");
    expect(file[2]).toContain("1 cancelled entry is left out; 7 units have no cost recorded");
  });
});

describe("store and medicine CSV", () => {
  const totals = { sales: "980.00", invoices: 4, estimated: complete("700.00", "280.00"), realized: incomplete("500.00", "100.00", 2) };
  const store: StoreReport = {
    period: PERIOD,
    items: [{ store_id: "11111111-1111-1111-1111-111111111111", name: '=HYPERLINK("x")', sales: "500.00", invoices: 1, share: "51.0", estimated: complete("0.00", null), realized: incomplete("0.00", null, 1) }],
    total: 1,
    totals,
    filtered_totals: { ...totals, sales: "500.00", invoices: 1 },
  };

  it("writes a store name that looks like a formula as text and adds both totals rows when a search is on", () => {
    const file = lines(storesCsv(store));
    expect(file[1].startsWith(`2026-11-01 to 2026-11-25,"'=HYPERLINK(""x"")",500.00,1,51.0,`)).toBe(true);
    expect(file[2]).toContain("TOTAL (rows in this file)");
    expect(file[3]).toContain("TOTAL (whole period)");
    expect(file[3]).toContain("980.00");
  });

  it("has one TOTAL row when nothing is filtered", () => {
    const file = lines(storesCsv({ ...store, filtered_totals: totals }));
    expect(file.filter((l) => l.includes("TOTAL"))).toHaveLength(1);
  });

  const medicine: MedicineReport = {
    period: PERIOD,
    items: [{ key: "a:strip", product_id: "11111111-1111-1111-1111-111111111111", name: "Panadol, 500", typed_name: null, strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", unit: "strip", billed_quantity: 3, sales: "150.00", estimated: complete("120.00", "30.00"), realized: complete("120.00", "30.00") }],
    typed_rows: [{ key: "typed:noran:strip", product_id: null, name: "Noran 20mg cap", typed_name: "Noran 20mg cap", strength: null, dosage_form: null, pack_size: null, manufacturer: null, unit: "strip", billed_quantity: 3, sales: "120.00", estimated: incomplete("0.00", null, 1), realized: incomplete("0.00", null, 1) }],
    total: 1,
    totals: { ...totals, sales: "270.00" },
    filtered_totals: { ...totals, sales: "270.00" },
  };

  it("includes the typed group marked Not registered and quotes a name with a comma", () => {
    const file = lines(medicinesCsv(medicine));
    expect(file[1]).toContain('"Panadol, 500",500 mg,tablet,10,GSK,strip,Registered,3,150.00');
    expect(file[2]).toContain("Noran 20mg cap,,,,,strip,Not registered,3,120.00");
    expect(file[3]).toContain("TOTAL");
    expect(file[3]).toContain("270.00");
  });

  const missing: CostMissingReport = {
    period: PERIOD,
    total: 1,
    truncated: false,
    items: [{ product_id: "11111111-1111-1111-1111-111111111111", name: "Zinc", strength: "20 mg", dosage_form: null, pack_size: null, manufacturer: null, unit: "strip", sales_amount: "300.00", billed_quantity: 3, lines: 2, estimate_missing: true, realized_missing: true, realized_dates: ["2026-05-04", "2026-05-05"], reason: "no_purchase_on_market_day" }],
  };

  it("writes the cost-missing rows with the market days and the reason", () => {
    const file = lines(costMissingCsv(missing));
    expect(file[1]).toContain("Zinc,20 mg,,,,strip,Registered,300.00,3,2,Yes,Yes,2026-05-04; 2026-05-05,no_purchase_on_market_day");
    expect(file[2]).toContain("TOTAL");
    expect(file[2]).toContain("1 medicine");
  });
});

describe("balances CSV", () => {
  it("lists every store with its signed balance, the totals, and the note about older invoices; an advance stays a negative number", () => {
    const rows = [
      { store_id: "a", name: "Owes Store", is_active: true, balance: "5000.00", owes: true, advance: false, entry_count: 4, last_entry_date: "2026-11-20" },
      { store_id: "b", name: "Advance Store", is_active: true, balance: "-2000.00", owes: false, advance: true, entry_count: 2, last_entry_date: "2026-11-21" },
      { store_id: "c", name: "Settled Store", is_active: false, balance: "0.00", owes: false, advance: false, entry_count: 0, last_entry_date: null },
    ];
    const file = lines(balancesCsv("2026-11-25", rows, { total_owed: "5000.00", stores_owing: 1, total_advance: "2000.00", stores_with_advance: 1 }, { invoices: 2, total: "250.50" }));
    expect(file[1]).toBe("2026-11-25,Owes Store,5000.00,Owes,4,2026-11-20,Yes,");
    expect(file[2]).toBe("2026-11-25,Advance Store,-2000.00,Advance,2,2026-11-21,Yes,");
    expect(file[3]).toBe("2026-11-25,Settled Store,0.00,Settled,0,,No,");
    expect(file[4]).toContain("TOTAL OWED,5000.00,Owes");
    expect(file[4]).toContain("2 invoices issued before store accounts existed (250.50) are not in any balance");
    expect(file[5]).toContain("TOTAL ADVANCE (not taken off the total owed),2000.00,Advance");
  });
});
