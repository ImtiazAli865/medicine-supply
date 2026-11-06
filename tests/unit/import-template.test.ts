import { describe, expect, it } from "vitest";
import { TEMPLATE_HEADINGS } from "../../src/lib/import/columns";
import { readCsv } from "../../src/lib/import/read-csv";
import { readImportFile } from "../../src/lib/import/read-file";
import { EXAMPLE_ROW, templateCsv, templateXlsx } from "../../src/lib/import/template";
import { fileLike } from "../helpers/import-files";
import Papa from "papaparse";

describe("templates", () => {
  it("CSV: row 1 is exactly the 12 headings, row 2 is the marked example", () => {
    const text = templateCsv();
    expect(text.charCodeAt(0)).toBe(0xfeff); // so Excel opens it as UTF-8
    const rows = Papa.parse<string[]>(text.slice(1), { skipEmptyLines: true }).data;
    expect(rows[0]).toEqual(TEMPLATE_HEADINGS);
    expect(rows[1]).toEqual(EXAMPLE_ROW);
    expect(rows[1][0]).toMatch(/^EXAMPLE/);
    expect(rows).toHaveLength(2);
  });

  it("CSV: reading it back finds no importable rows and reports the ignored example", async () => {
    await expect(readCsv(new TextEncoder().encode(templateCsv()))).rejects.toMatchObject({
      code: "no_rows",
      message: expect.stringMatching(/only the example row/),
    });
  });

  it("XLSX: first sheet has the headings and the example; the second sheet says name and unit are required", async () => {
    const blob = await templateXlsx();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { readSheet } = await import("read-excel-file/universal");
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const first = (await readSheet(buf, 1)) as string[][];
    expect(first[0]).toEqual(TEMPLATE_HEADINGS);
    expect(first[1][0]).toMatch(/^EXAMPLE/);
    const second = (await readSheet(buf, 2)) as string[][];
    expect(second.flat().join(" ")).toMatch(/name and unit are REQUIRED/);
  });

  it("XLSX: reading it back through the real reader finds no importable rows", async () => {
    const bytes = new Uint8Array(await (await templateXlsx()).arrayBuffer());
    await expect(readImportFile(fileLike("template.xlsx", bytes))).rejects.toMatchObject({ code: "no_rows" });
  });
});
