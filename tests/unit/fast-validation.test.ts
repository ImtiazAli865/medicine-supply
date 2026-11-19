import { describe, expect, it } from "vitest";
import { MedicinesQuerySchema, RepeatQuerySchema, UsualQuerySchema } from "@/lib/validation/fast-order";

const ID = "6f1c0c7e-6a0d-4a58-9f30-0d9d8f1c2b3a";

describe("medicines query", () => {
  it("pages the catalog by default with up to 900 rows", () => {
    expect(MedicinesQuerySchema.parse({})).toEqual({ q: null, limit: 900, cursor: undefined });
  });

  it("searches with at most 30 rows and trims the text", () => {
    expect(MedicinesQuerySchema.parse({ q: "  pan   500 " })).toEqual({ q: "pan 500", limit: 30, cursor: undefined });
    expect(MedicinesQuerySchema.parse({ q: "pan", limit: "10" }).limit).toBe(10);
  });

  it("treats blank text as no search", () => {
    expect(MedicinesQuerySchema.parse({ q: "   " }).q).toBeNull();
  });

  it("rejects a limit above the maximum, below 1 or not a number", () => {
    expect(MedicinesQuerySchema.safeParse({ limit: "901" }).success).toBe(false);
    expect(MedicinesQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(MedicinesQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
    expect(MedicinesQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
  });

  it("rejects a search with a limit above 30", () => {
    expect(MedicinesQuerySchema.safeParse({ q: "pan", limit: "31" }).success).toBe(false);
  });

  it("rejects text longer than 200 characters", () => {
    expect(MedicinesQuerySchema.safeParse({ q: "a".repeat(201) }).success).toBe(false);
  });

  it("keeps a cursor for the repository to decode", () => {
    expect(MedicinesQuerySchema.parse({ cursor: "900" }).cursor).toBe("900");
    expect(MedicinesQuerySchema.safeParse({ cursor: "1".repeat(13) }).success).toBe(false);
  });
});

describe("usual and repeat queries", () => {
  it("need valid UUIDs", () => {
    expect(UsualQuerySchema.safeParse({ store_id: ID }).success).toBe(true);
    expect(UsualQuerySchema.safeParse({ store_id: "nope" }).success).toBe(false);
    expect(UsualQuerySchema.safeParse({}).success).toBe(false);
    expect(RepeatQuerySchema.safeParse({ store_id: ID, order_id: ID }).success).toBe(true);
    expect(RepeatQuerySchema.safeParse({ store_id: ID }).success).toBe(false);
    expect(RepeatQuerySchema.safeParse({ store_id: ID, order_id: "x" }).success).toBe(false);
  });
});
