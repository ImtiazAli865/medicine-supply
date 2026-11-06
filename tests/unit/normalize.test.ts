import { describe, expect, it } from "vitest";
import { emptyToNull, escapeLike, norm, searchTokens } from "@/lib/normalize";

describe("norm", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(norm("  Panadol   500MG  ")).toBe("panadol 500mg");
    expect(norm("PANADOL")).toBe(norm("panadol"));
  });

  it("treats null and undefined as empty", () => {
    expect(norm(null)).toBe("");
    expect(norm(undefined)).toBe("");
  });

  it("keeps Urdu and mixed-script text intact", () => {
    expect(norm("  پینا ڈول   Panadol ")).toBe("پینا ڈول panadol");
  });
});

describe("escapeLike", () => {
  it("escapes wildcard characters so they match literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves quotes alone (they are not LIKE wildcards)", () => {
    expect(escapeLike(`it's "x"`)).toBe(`it's "x"`);
  });
});

describe("searchTokens", () => {
  it("splits into lowercase tokens", () => {
    expect(searchTokens("  PAN  500 ")).toEqual(["pan", "500"]);
  });

  it("limits the number of tokens and handles empty input", () => {
    expect(searchTokens("a b c d e f g h i j", 3)).toEqual(["a", "b", "c"]);
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens(null)).toEqual([]);
  });
});

describe("emptyToNull", () => {
  it("turns blank text into null and trims the rest", () => {
    expect(emptyToNull("  ")).toBeNull();
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull("  x ")).toBe("x");
  });
});
