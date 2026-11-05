import { describe, expect, it } from "vitest";
import { ChecklistDismissSchema, SettingsUpdateSchema } from "../../src/lib/validation/settings";

const ok = { expected_version: 1, name: "Acme Pharma", phone: "0300", address: "Lahore", thermal_paper_mm: 80, account_summary_default: false };

function fieldOf(input: unknown): Record<string, string> {
  const r = SettingsUpdateSchema.safeParse(input);
  if (r.success) throw new Error("expected a failure");
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("settings validation", () => {
  it("accepts valid settings and trims text", () => {
    const r = SettingsUpdateSchema.parse({ ...ok, name: "  Acme  ", phone: "  0300 " });
    expect(r.name).toBe("Acme");
    expect(r.phone).toBe("0300");
  });

  it("maps empty or missing phone and address to null (never a default)", () => {
    const r = SettingsUpdateSchema.parse({ ...ok, phone: "  ", address: undefined });
    expect(r.phone).toBeNull();
    expect(r.address).toBeNull();
  });

  it("requires a name of 1-200 characters", () => {
    expect(fieldOf({ ...ok, name: "   " }).name).toMatch(/Enter the business name/);
    expect(fieldOf({ ...ok, name: undefined }).name).toMatch(/Enter the business name/);
    expect(SettingsUpdateSchema.safeParse({ ...ok, name: "x".repeat(200) }).success).toBe(true);
    expect(fieldOf({ ...ok, name: "x".repeat(201) }).name).toMatch(/at most 200/);
  });

  it("limits phone to 50 and address to 500 characters", () => {
    expect(SettingsUpdateSchema.safeParse({ ...ok, phone: "1".repeat(50), address: "a".repeat(500) }).success).toBe(true);
    expect(fieldOf({ ...ok, phone: "1".repeat(51) }).phone).toMatch(/at most 50/);
    expect(fieldOf({ ...ok, address: "a".repeat(501) }).address).toMatch(/at most 500/);
  });

  it.each([40, 58, 80, 120])("accepts a paper width of %i mm", (mm) => {
    expect(SettingsUpdateSchema.safeParse({ ...ok, thermal_paper_mm: mm }).success).toBe(true);
  });

  it.each([
    [39, /at least 40/],
    [121, /at most 120/],
    [80.5, /whole number/],
    ["80", /whole number of millimetres/],
    ["abc", /whole number of millimetres/],
    [null, /whole number of millimetres/],
  ])("refuses a paper width of %s", (mm, message) => {
    expect(fieldOf({ ...ok, thermal_paper_mm: mm }).thermal_paper_mm).toMatch(message);
  });

  it("requires a boolean for the Account Summary default and an expected version", () => {
    expect(fieldOf({ ...ok, account_summary_default: "yes" }).account_summary_default).toBeDefined();
    expect(fieldOf({ ...ok, expected_version: undefined }).expected_version).toBeDefined();
    expect(fieldOf({ ...ok, expected_version: 0 }).expected_version).toBeDefined();
  });

  it("checklist dismissal needs a boolean", () => {
    expect(ChecklistDismissSchema.safeParse({ dismissed: true }).success).toBe(true);
    expect(ChecklistDismissSchema.safeParse({}).success).toBe(false);
    expect(ChecklistDismissSchema.safeParse({ dismissed: "true" }).success).toBe(false);
  });
});
