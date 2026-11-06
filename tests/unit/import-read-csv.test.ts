import { describe, expect, it } from "vitest";
import { readCsv } from "../../src/lib/import/read-csv";
import { ImportFileError } from "../../src/lib/import/types";
import { HEADER_ROW, tooManyRowsCsv, tooWideCsv, toCsv, validCsv, VALID_5_ROWS } from "../helpers/import-files";

const enc = (s: string) => new TextEncoder().encode(s);

async function problem(bytes: Uint8Array) {
  try {
    await readCsv(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(ImportFileError);
    return e as ImportFileError;
  }
  throw new Error("expected a rejection");
}

describe("readCsv", () => {
  it("reads rows with file row numbers (the heading row is 1) and keeps empty cells as missing", async () => {
    const { rows } = await readCsv(enc(validCsv()));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ row_no: 2, name: "Amoxil", unit: "strip", purchase_price: "40" });
    expect(rows[2].purchase_price).toBeUndefined();
    expect(rows[4].row_no).toBe(6);
  });

  it("removes a UTF-8 byte-order mark and reads Urdu text correctly", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(validCsv())]);
    const { rows } = await readCsv(bom);
    expect(rows[4].name).toBe("پیراسیٹامول");
    expect(rows).toHaveLength(5);
  });

  it("handles quoted commas, quotes and line breaks inside cells", async () => {
    const text = toCsv([HEADER_ROW, ['Cough "Syrup", extra', "bottle", "", "", "", "", "", "", "", "", "", ""], ["Line\nbreak", "box", "", "", "", "", "", "", "", "", "", ""]]);
    const { rows } = await readCsv(enc(text));
    expect(rows[0].name).toBe('Cough "Syrup", extra');
    expect(rows[1].name).toBe("Line break");
  });

  it("ignores blank rows but keeps row numbers aligned with the file", async () => {
    const text = [HEADER_ROW.join(","), "A,strip", "", ",,,", "B,strip", "", ""].join("\r\n");
    const { rows } = await readCsv(enc(text));
    expect(rows.map((r) => [r.row_no, r.name])).toEqual([[2, "A"], [5, "B"]]);
  });

  it("ignores the template's example row and says so", async () => {
    const text = ["name,unit", "EXAMPLE - delete this row,strip", "Real,strip"].join("\n");
    const res = await readCsv(enc(text));
    expect(res.exampleIgnored).toBe(true);
    expect(res.rows).toEqual([{ row_no: 3, name: "Real", unit: "strip" }]);
  });

  it("reports a header-only file, an empty file and a file of blank lines", async () => {
    expect((await problem(enc(HEADER_ROW.join(",") + "\n"))).code).toBe("no_rows");
    expect((await problem(enc(""))).code).toBe("empty");
    expect((await problem(enc("\n\n\n"))).code).toBe("empty");
  });

  it("reports a semicolon-delimited file instead of guessing", async () => {
    const e = await problem(enc("name;unit;brand\nA;strip;B\n"));
    expect(e.code).toBe("wrong_delimiter");
    expect(e.message).toMatch(/semicolons or tabs/);
  });

  it("reports bad encoding (not UTF-8)", async () => {
    // 0xE9 alone is Latin-1 'é', invalid UTF-8
    const bytes = new Uint8Array([...enc("name,unit\nCaf"), 0xe9, ...enc(",strip\n")]);
    expect((await problem(bytes)).code).toBe("bad_encoding");
  });

  it("rejects unknown, missing or repeated headings", async () => {
    expect((await problem(enc("name,unit,colour\nA,strip,red\n"))).code).toBe("bad_headings");
    expect((await problem(enc("name,brand\nA,B\n"))).code).toBe("bad_headings");
    expect((await problem(enc("name,unit,name\nA,strip,B\n"))).code).toBe("bad_headings");
  });

  it("rejects data under a blank heading instead of dropping it", async () => {
    expect((await problem(enc("name,unit,\nA,strip,hidden\n"))).code).toBe("bad_headings");
    // but a blank trailing heading with empty cells is fine
    expect((await readCsv(enc("name,unit,\nA,strip,\n"))).rows).toHaveLength(1);
  });

  it("is case and spacing tolerant for headings, any column order", async () => {
    const { rows } = await readCsv(enc(" UNIT , Name ,Pack  Size\nstrip,A,10 tabs\n"));
    expect(rows[0]).toMatchObject({ name: "A", unit: "strip", pack_size: "10 tabs" });
  });

  it("refuses more than 10,000 data rows", async () => {
    expect((await problem(enc(tooManyRowsCsv()))).code).toBe("too_many_rows");
  });

  it("accepts exactly 10,000 rows", async () => {
    const rows = Array.from({ length: 10000 }, (_, i) => [`M${i}`, "strip"]);
    const res = await readCsv(enc(toCsv([["name", "unit"], ...rows])));
    expect(res.rows).toHaveLength(10000);
  });

  it("refuses a file whose text is too large to send at once", async () => {
    expect((await problem(enc(tooWideCsv()))).code).toBe("too_wide");
  });

  it("reads the valid fixture rows exactly", async () => {
    const { rows } = await readCsv(enc(validCsv()));
    expect(rows.map((r) => r.name)).toEqual(VALID_5_ROWS.map((r) => r[0]));
  });
});
