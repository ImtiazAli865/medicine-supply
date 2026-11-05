import { describe, expect, it } from "vitest";
import { readImportFile } from "../../src/lib/import/read-file";
import { readXlsx } from "../../src/lib/import/read-xlsx";
import { validateRow } from "../../src/lib/import/validate-row";
import { ImportFileError } from "../../src/lib/import/types";
import { fileLike, HEADER_ROW, validXlsx, xlsxBytes } from "../helpers/import-files";

describe("readXlsx", () => {
  it("reads the first sheet and keeps numbers as exact text", async () => {
    const bytes = await xlsxBytes([
      { name: "Medicines", rows: [["name", "unit", "selling price", "purchase price"], ["Amoxil", "strip", 99.99, 40]] },
    ]);
    const { rows } = await readXlsx(bytes);
    expect(rows).toEqual([{ row_no: 2, name: "Amoxil", unit: "strip", selling_price: "99.99", purchase_price: "40" }]);
  });

  it("keeps a float artefact as exact text so validation can refuse it (never rounds)", async () => {
    const bytes = await xlsxBytes([{ name: "S", rows: [["name", "unit", "selling price"], ["A", "strip", 0.1 + 0.2]] }]);
    const { rows } = await readXlsx(bytes);
    expect(rows[0].selling_price).toBe("0.30000000000000004");
    const v = validateRow(rows[0]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.invalid.message).toMatch(/at most two decimals/);
  });

  it("reads only the first sheet and returns its name through readImportFile", async () => {
    const bytes = await xlsxBytes([
      { name: "Stock", rows: [HEADER_ROW, ["Amoxil", "strip", ...Array(10).fill(null)]] },
      { name: "Other", rows: [["name", "unit"], ["Ignored", "strip"]] },
    ]);
    const res = await readImportFile(fileLike("a.xlsx", bytes));
    expect(res.sheetName).toBe("Stock");
    expect(res.fileKind).toBe("xlsx");
    expect(res.rows.map((r) => r.name)).toEqual(["Amoxil"]);
  });

  it("skips blank rows and keeps row numbers", async () => {
    const bytes = await xlsxBytes([
      { name: "S", rows: [["name", "unit"], ["A", "strip"], [null, null], ["B", "box"]] },
    ]);
    const { rows } = await readXlsx(bytes);
    expect(rows.map((r) => [r.row_no, r.name])).toEqual([[2, "A"], [4, "B"]]);
  });

  it("refuses a workbook with only headings", async () => {
    const bytes = await xlsxBytes([{ name: "S", rows: [["name", "unit"]] }]);
    await expect(readXlsx(bytes)).rejects.toMatchObject({ code: "no_rows" });
  });

  it("refuses unknown headings like the CSV reader", async () => {
    const bytes = await xlsxBytes([{ name: "S", rows: [["name", "unit", "colour"], ["A", "strip", "red"]] }]);
    await expect(readXlsx(bytes)).rejects.toBeInstanceOf(ImportFileError);
  });

  it("reads the valid fixture workbook", async () => {
    const res = await readImportFile(fileLike("valid.xlsx", await validXlsx()));
    expect(res.rows).toHaveLength(5);
    expect(res.rows[3]).toMatchObject({ name: "Calpol", purchase_price: "50.50" });
    expect(res.rows[4].name).toBe("پیراسیٹامول");
  });

  it("refuses more than 10,000 rows", async () => {
    const rows: (string | null)[][] = [["name", "unit"], ...Array.from({ length: 10001 }, (_, i) => [`M${i}`, "strip"])];
    await expect(readXlsx(await xlsxBytes([{ name: "S", rows }]))).rejects.toMatchObject({ code: "too_many_rows" });
  });
});
