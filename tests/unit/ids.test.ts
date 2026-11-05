import { afterEach, describe, expect, it, vi } from "vitest";
import { isUuid, newId } from "../../src/lib/ids";

afterEach(() => vi.unstubAllGlobals());

describe("newId", () => {
  it("returns a valid UUID", () => {
    expect(isUuid(newId())).toBe(true);
  });

  it("still works when crypto.randomUUID is missing (plain http on a phone), and ids differ", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe("4"); // version 4
      expect("89ab").toContain(id[19]); // RFC 4122 variant
    }
  });
});
