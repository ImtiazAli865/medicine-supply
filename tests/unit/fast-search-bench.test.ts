import { describe, expect, it } from "vitest";
import { filterMedicines, normalizeRow, parseQuery } from "@/lib/orders/fast-search";
import type { SlimMedicine } from "@/lib/orders/fast-types";

// The filter budget of Module 008 (research D12): the pure filter on 5,000 medicines stays under 20 ms per keystroke.
// The measured figures are printed so they can be recorded in quickstart section 6; nothing here is a promise about a phone.

const FORMS = ["tablet", "capsule", "syrup", "injection", "drops", "cream"];
function build(count: number): SlimMedicine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${String(i).padStart(5, "0")}`,
    name: `Medicine ${String(i).padStart(5, "0")} ${["Alpha", "Beta", "Gamma", "Delta"][i % 4]}`,
    unit: "strip",
    brand: i % 3 === 0 ? `Brand ${i % 50}` : null,
    generic_name: i % 5 === 0 ? `Generic ${i % 40}` : null,
    strength: `${(i % 9) * 50 + 50} mg`,
    dosage_form: FORMS[i % FORMS.length]!,
    manufacturer: `Maker ${(i % 17) + 1} Pharmaceuticals Limited`,
    pack_size: String((i % 5) * 10 + 10),
    sku: `SKU-${i}`,
    selling_price: null,
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("filter speed on 5,000 medicines", () => {
  const rows = build(5000).map(normalizeRow);

  function time(query: string, runs = 41): { median: number; max: number } {
    const words = parseQuery(query).words;
    const times: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const start = performance.now();
      filterMedicines(rows, words);
      times.push(performance.now() - start);
    }
    return { median: median(times), max: Math.max(...times) };
  }

  it("answers a one-letter query (about every row matches) within the budget", () => {
    const t = time("a");
    console.info(`fast-search 5,000 rows, "a": median ${t.median.toFixed(2)} ms, max ${t.max.toFixed(2)} ms`);
    expect(t.median).toBeLessThan(20);
  });

  it("answers an eight-word worst case within the budget", () => {
    const t = time("medicine alpha maker pharmaceuticals limited tablet mg 5");
    console.info(`fast-search 5,000 rows, 8 words: median ${t.median.toFixed(2)} ms, max ${t.max.toFixed(2)} ms`);
    expect(t.median).toBeLessThan(20);
  });

  it("answers a query that matches nothing within the budget", () => {
    const t = time("zzzzzz");
    console.info(`fast-search 5,000 rows, no match: median ${t.median.toFixed(2)} ms, max ${t.max.toFixed(2)} ms`);
    expect(t.median).toBeLessThan(20);
  });

  it("preparing the 5,000 rows once is also quick", () => {
    const data = build(5000);
    const start = performance.now();
    data.map(normalizeRow);
    const elapsed = performance.now() - start;
    console.info(`fast-search prepare 5,000 rows: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(200);
  });
});
