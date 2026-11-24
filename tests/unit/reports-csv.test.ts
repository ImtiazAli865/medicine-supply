import { describe, expect, it } from "vitest";
import { csvNumber, csvText, toCsv } from "@/lib/reports/csv";

describe("report CSV cells", () => {
  it("puts an apostrophe before text that a spreadsheet would run as a formula", () => {
    expect(csvText("=1+1")).toBe("'=1+1");
    expect(csvText("+cmd")).toBe("'+cmd");
    expect(csvText("-cmd")).toBe("'-cmd");
    expect(csvText("@sum")).toBe("'@sum");
    expect(csvText("=SUM(1)")).toBe("'=SUM(1)");
  });

  it("leaves a negative number as a number", () => {
    expect(csvNumber("-12.50")).toBe("-12.50");
    expect(csvNumber("0.00")).toBe("0.00");
    expect(csvNumber(5)).toBe("5");
    expect(csvNumber(-3)).toBe("-3");
  });

  it("writes nothing for a missing number and refuses text that is not a number", () => {
    expect(csvNumber(null)).toBe("");
    expect(csvNumber(undefined)).toBe("");
    expect(csvNumber("")).toBe("");
    expect(() => csvNumber("=1+1")).toThrow();
    expect(() => csvNumber("12,50")).toThrow();
    expect(() => csvNumber("PKR 12.00")).toThrow();
  });

  it("quotes a name with a comma, a quote or a line break", () => {
    expect(csvText("Panadol, 500 mg")).toBe('"Panadol, 500 mg"');
    expect(csvText('Tab "forte"')).toBe('"Tab ""forte"""');
    expect(csvText("line\nbreak")).toBe('"line\nbreak"');
  });

  it("builds a file with CRLF line ends and the header cells as text", () => {
    const file = toCsv(["Name", "Sales"], [[csvText("A"), csvNumber("1.00")], [csvText("=B"), csvNumber("-2.00")]]);
    expect(file).toBe("Name,Sales\r\nA,1.00\r\n'=B,-2.00\r\n");
  });
});
