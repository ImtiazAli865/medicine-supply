import { describe, expect, it } from "vitest";
import { inspectFile } from "../../src/lib/import/inspect-file";
import { ImportFileError } from "../../src/lib/import/types";
import { damagedXlsx, fileLike, macroXlsx, manyEntriesXlsx, passwordProtectedXlsx, tooLargeCsv, validCsv, validXlsx, xlsxBytes } from "../helpers/import-files";

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportFileError);
    return (e as ImportFileError).code;
  }
  throw new Error("expected a rejection");
}

describe("inspectFile", () => {
  it("accepts a CSV and a real xlsx and reports the first sheet name", async () => {
    expect((await inspectFile(fileLike("list.csv", validCsv()))).kind).toBe("csv");
    const x = await inspectFile(fileLike("LIST.XLSX", await validXlsx()));
    expect(x.kind).toBe("xlsx");
    expect(x.sheetName).toBe("Medicines");
  });

  it("decodes XML entities in the sheet name", async () => {
    const bytes = await xlsxBytes([{ name: "A & B <1>", rows: [["name", "unit"], ["x", "y"]] }]);
    expect((await inspectFile(fileLike("a.xlsx", bytes))).sheetName).toBe("A & B <1>");
  });

  it("refuses other types, with a hint for xls and xlsm", async () => {
    expect(await code(inspectFile(fileLike("a.pdf", "%PDF-1.4")))).toBe("unsupported_type");
    expect(await code(inspectFile(fileLike("a.png", "x")))).toBe("unsupported_type");
    await expect(inspectFile(fileLike("a.xls", "x"))).rejects.toThrow(/Old Excel files/);
    await expect(inspectFile(fileLike("a.xlsm", "x"))).rejects.toThrow(/macros/);
  });

  it("refuses an empty file and a file over 5 MB (without reading it)", async () => {
    expect(await code(inspectFile(fileLike("a.csv", "")))).toBe("empty");
    expect(await code(inspectFile(fileLike("big.csv", tooLargeCsv())))).toBe("too_large");
  });

  it("refuses a PDF or zip renamed to .csv", async () => {
    expect(await code(inspectFile(fileLike("a.csv", "%PDF-1.4 ...")))).toBe("unsupported_type");
    expect(await code(inspectFile(fileLike("a.csv", await validXlsx())))).toBe("unsupported_type");
  });

  it("refuses a password-protected / old-format workbook", async () => {
    expect(await code(inspectFile(fileLike("a.xlsx", passwordProtectedXlsx())))).toBe("password_protected");
  });

  it("refuses a damaged zip and non-zip bytes", async () => {
    expect(await code(inspectFile(fileLike("a.xlsx", await damagedXlsx())))).toBe("damaged");
    expect(await code(inspectFile(fileLike("a.xlsx", "this is not a zip")))).toBe("damaged");
  });

  it("refuses a workbook that contains macros", async () => {
    expect(await code(inspectFile(fileLike("a.xlsx", macroXlsx())))).toBe("macros");
  });

  it("refuses a zip with too many entries without inflating it", async () => {
    expect(await code(inspectFile(fileLike("a.xlsx", manyEntriesXlsx())))).toBe("too_large");
  });
});
