import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ListQuerySchema, StoreCreateSchema, StoreUpdateSchema } from "@/lib/validation/store";

describe("StoreCreateSchema", () => {
  it("accepts a store with only an id and a name", () => {
    const parsed = StoreCreateSchema.parse({ id: randomUUID(), name: "  Al Madina Medical  " });
    expect(parsed.name).toBe("Al Madina Medical");
    expect(parsed.contact_person).toBeNull();
    expect(parsed.phone).toBeNull();
    expect(parsed.address).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.confirm_duplicate).toBe(false);
  });

  it("requires a name, and rejects a blank name", () => {
    expect(StoreCreateSchema.safeParse({ id: randomUUID() }).success).toBe(false);
    const blank = StoreCreateSchema.safeParse({ id: randomUUID(), name: "   " });
    expect(blank.success).toBe(false);
  });

  it("requires a valid client-generated id", () => {
    expect(StoreCreateSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(StoreCreateSchema.safeParse({ id: "not-a-uuid", name: "X" }).success).toBe(false);
  });

  it("turns blank optional fields into null and trims the rest", () => {
    const parsed = StoreCreateSchema.parse({
      id: randomUUID(),
      name: "X",
      phone: "  0300 1234567 ",
      contact_person: "   ",
      notes: "",
    });
    expect(parsed.phone).toBe("0300 1234567");
    expect(parsed.contact_person).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("enforces the length limits", () => {
    const id = randomUUID();
    expect(StoreCreateSchema.safeParse({ id, name: "n".repeat(201) }).success).toBe(false);
    expect(StoreCreateSchema.safeParse({ id, name: "n".repeat(200) }).success).toBe(true);
    expect(StoreCreateSchema.safeParse({ id, name: "X", phone: "1".repeat(51) }).success).toBe(false);
    expect(StoreCreateSchema.safeParse({ id, name: "X", address: "a".repeat(501) }).success).toBe(false);
    expect(StoreCreateSchema.safeParse({ id, name: "X", notes: "n".repeat(1001) }).success).toBe(false);
  });

  it("accepts Urdu and mixed-script names", () => {
    const parsed = StoreCreateSchema.parse({ id: randomUUID(), name: "المدینہ میڈیکل Store" });
    expect(parsed.name).toBe("المدینہ میڈیکل Store");
  });
});

describe("StoreUpdateSchema", () => {
  it("requires expected_version", () => {
    expect(StoreUpdateSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(StoreUpdateSchema.safeParse({ expected_version: 1, name: "X" }).success).toBe(true);
  });

  it("keeps missing fields undefined (unchanged) and turns blank or null into null (cleared)", () => {
    const parsed = StoreUpdateSchema.parse({ expected_version: 2, phone: "", notes: null });
    expect(parsed.phone).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.address).toBeUndefined();
    expect(parsed.name).toBeUndefined();
    expect(parsed.is_active).toBeUndefined();
  });

  it("does not allow an empty name", () => {
    expect(StoreUpdateSchema.safeParse({ expected_version: 1, name: " " }).success).toBe(false);
  });

  it("accepts is_active for deactivate and reactivate", () => {
    expect(StoreUpdateSchema.parse({ expected_version: 1, is_active: false }).is_active).toBe(false);
  });
});

describe("ListQuerySchema", () => {
  it("applies defaults", () => {
    expect(ListQuerySchema.parse({})).toEqual({ q: "", status: "active", limit: 50 });
  });

  it("rejects an unknown status and an out-of-range limit", () => {
    expect(ListQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(ListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("coerces a numeric limit from the query string", () => {
    expect(ListQuerySchema.parse({ limit: "25" }).limit).toBe(25);
  });
});
