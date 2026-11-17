import { afterEach, describe, expect, it, vi } from "vitest";
import { stateFromPreview } from "@/lib/voice/preview-state";
import { describeUnusable, findUnusableLines, readMedicineStatuses, unusableLines } from "@/lib/voice/unusable";
import { candidate, preview, previewLine } from "../helpers/voice";

// FR-028: when the server refuses a draft because a medicine is no longer usable, the screen names the line.

const lines = [
  previewLine("l0", "Panadol", { state: "matched", candidates: [candidate("p1", "Panadol", { is_exact: true })], productId: "p1", quantity: 5, unit: "strip" }),
  previewLine("l1", "brufen", { state: "matched", candidates: [candidate("b1", "Brufen 400", { is_exact: true })], productId: "b1", quantity: 2, unit: "box" }),
  previewLine("l2", "cough syrup", { state: "unknown", quantity: 1, unit: "bottle" }),
  previewLine("l3", "Panadol", { state: "matched", candidates: [candidate("p1", "Panadol", { is_exact: true })], productId: "p1", quantity: 1, unit: "strip" }),
];
const state = () => stateFromPreview(preview(lines));

function stubFetch(answers: Record<string, { status: number; body: unknown } | "network">) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const id = url.split("/").pop() as string;
    const answer = answers[id];
    if (answer === "network" || !answer) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unusableLines", () => {
  it("names every catalog line whose medicine is inactive or missing, with the chosen name when it differs, and skips typed lines", () => {
    const found = unusableLines(state(), (id) => (id === "p1" ? "inactive" : id === "b1" ? "missing" : "active"));
    expect(found.map((l) => [l.label, l.reason])).toEqual([
      ["Panadol", "inactive"],
      ["brufen (Brufen 400)", "missing"],
      ["Panadol", "inactive"],
    ]);
  });

  it("names nothing when every medicine is active or the status is unknown", () => {
    expect(unusableLines(state(), () => "active")).toEqual([]);
    expect(unusableLines(state(), () => "unknown")).toEqual([]);
  });
});

describe("describeUnusable", () => {
  it("quotes the lines, says nothing was created, and says what to do", () => {
    const one = describeUnusable([{ key: "l0", label: "Panadol", reason: "inactive" }]);
    expect(one).toContain('"Panadol"');
    expect(one).toMatch(/Nothing was created/);
    expect(one).toMatch(/Remove that line or add the medicine as typed/);
    const many = describeUnusable([
      { key: "l0", label: "Panadol", reason: "inactive" },
      { key: "l1", label: "Brufen", reason: "missing" },
    ]);
    expect(many).toContain('"Panadol", "Brufen"');
  });
});

describe("readMedicineStatuses and findUnusableLines", () => {
  it("reads each distinct medicine once and reads only whether it is active", async () => {
    const calls = stubFetch({
      p1: { status: 200, body: { id: "p1", is_active: false, selling_price: "125.50", purchase_price: "80.00", mrp: "130.00" } },
      b1: { status: 200, body: { id: "b1", is_active: true } },
    });
    const statuses = await readMedicineStatuses(state());
    expect(calls.sort()).toEqual(["/api/products/b1", "/api/products/p1"]);
    expect([...statuses.entries()].sort()).toEqual([
      ["b1", "active"],
      ["p1", "inactive"],
    ]);
  });

  it("treats a 404 as missing and a failed read as unknown, never as unusable", async () => {
    stubFetch({ p1: { status: 404, body: { code: "not_found", message: "Not found." } }, b1: "network" });
    const statuses = await readMedicineStatuses(state());
    expect(statuses.get("p1")).toBe("missing");
    expect(statuses.get("b1")).toBe("unknown");
    const found = await findUnusableLines(state());
    expect(found.map((l) => l.label)).toEqual(["Panadol", "Panadol"]);
  });
});
