import { describe, expect, it } from "vitest";
import { nextDelayMs } from "@/lib/device/backoff";

describe("backoff", () => {
  it("is immediate for the first try", () => {
    expect(nextDelayMs(0)).toBe(0);
    expect(nextDelayMs(-1)).toBe(0);
    expect(nextDelayMs(Number.NaN)).toBe(0);
  });

  it("grows 2 s, 5 s, 15 s, 45 s and then stays at 2 minutes", () => {
    expect([1, 2, 3, 4].map(nextDelayMs)).toEqual([2_000, 5_000, 15_000, 45_000]);
    expect(nextDelayMs(5)).toBe(120_000);
    expect(nextDelayMs(50)).toBe(120_000);
  });

  it("never gets shorter as attempts grow", () => {
    let last = 0;
    for (let a = 0; a < 20; a += 1) {
      const d = nextDelayMs(a);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});
