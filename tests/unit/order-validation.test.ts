import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { zodFields } from "@/lib/api/errors";
import { OrderActionSchema, OrderCancelSchema, OrderListQuerySchema, OrderSaveSchema } from "@/lib/validation/order";

const line = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  product_id: randomUUID(),
  name: null,
  quantity: 3,
  unit: "strip",
  ...over,
});

const save = (over: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  expected_version: null,
  store_id: randomUUID(),
  notes: null,
  lines: [line()],
  ...over,
});

describe("OrderSaveSchema", () => {
  it("accepts a first save with a catalog line and ignores any name sent for it", () => {
    const parsed = OrderSaveSchema.parse(save({ lines: [line({ name: "ignored" })] }));
    expect(parsed.expected_version).toBeNull();
    expect(parsed.lines[0].name).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("accepts a later save with the version it was based on", () => {
    expect(OrderSaveSchema.parse(save({ expected_version: 4 })).expected_version).toBe(4);
    expect(() => OrderSaveSchema.parse(save({ expected_version: 0 }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ expected_version: 1.5 }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ expected_version: undefined }))).toThrow();
  });

  it("accepts a typed line, keeping the exact name with only the spaces cleaned", () => {
    const parsed = OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: "  Noran   20MG  Cap " })] }));
    expect(parsed.lines[0].product_id).toBeNull();
    expect(parsed.lines[0].name).toBe("Noran 20MG Cap");
  });

  it("keeps Urdu and mixed text in a typed name", () => {
    const parsed = OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: "پینا ڈول 500mg" })] }));
    expect(parsed.lines[0].name).toBe("پینا ڈول 500mg");
  });

  it("refuses a typed line without a name and a name that is too long", () => {
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: "   " })] }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: null })] }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: "x".repeat(201) })] }))).toThrow();
    expect(OrderSaveSchema.parse(save({ lines: [line({ product_id: null, name: "x".repeat(200) })] })).lines).toHaveLength(1);
  });

  it("allows only whole-number quantities from 1 to 100,000", () => {
    for (const bad of [0, -1, 1.5, 100001, "5", null, Number.NaN]) {
      expect(() => OrderSaveSchema.parse(save({ lines: [line({ quantity: bad })] })), String(bad)).toThrow();
    }
    expect(OrderSaveSchema.parse(save({ lines: [line({ quantity: 1 })] })).lines[0].quantity).toBe(1);
    expect(OrderSaveSchema.parse(save({ lines: [line({ quantity: 100000 })] })).lines[0].quantity).toBe(100000);
  });

  it("requires a unit of at most 50 characters and trims it", () => {
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ unit: "  " })] }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ unit: "u".repeat(51) })] }))).toThrow();
    expect(OrderSaveSchema.parse(save({ lines: [line({ unit: "  box " })] })).lines[0].unit).toBe("box");
  });

  it("limits notes to 1,000 characters; blank notes become null", () => {
    expect(OrderSaveSchema.parse(save({ notes: "  Deliver before noon " })).notes).toBe("Deliver before noon");
    expect(OrderSaveSchema.parse(save({ notes: "   " })).notes).toBeNull();
    expect(OrderSaveSchema.parse(save({ notes: "n".repeat(1000) })).notes).toHaveLength(1000);
    expect(() => OrderSaveSchema.parse(save({ notes: "n".repeat(1001) }))).toThrow();
  });

  it("limits an order to 200 lines", () => {
    const many = (n: number) => Array.from({ length: n }, () => line());
    expect(OrderSaveSchema.parse(save({ lines: many(200) })).lines).toHaveLength(200);
    expect(() => OrderSaveSchema.parse(save({ lines: many(201) }))).toThrow();
  });

  it("accepts an order with no lines (a draft is saved before the first line exists)", () => {
    expect(OrderSaveSchema.parse(save({ lines: [] })).lines).toEqual([]);
  });

  it("refuses repeated line ids and ids that are not UUIDs", () => {
    const id = randomUUID();
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ id }), line({ id })] }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ lines: [line({ id: "not-a-uuid" })] }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ store_id: "x" }))).toThrow();
    expect(() => OrderSaveSchema.parse(save({ request_id: "x" }))).toThrow();
  });

  it("reports a field message keyed by the first path segment", () => {
    const result = OrderSaveSchema.safeParse(save({ lines: [line({ quantity: 0 })] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(zodFields(result.error).lines).toMatch(/quantity/i);
  });
});

describe("OrderActionSchema and OrderCancelSchema", () => {
  it("needs a request id and the version the screen is based on", () => {
    expect(OrderActionSchema.parse({ request_id: randomUUID(), expected_version: 2 }).expected_version).toBe(2);
    expect(() => OrderActionSchema.parse({ request_id: randomUUID() })).toThrow();
    expect(() => OrderActionSchema.parse({ request_id: randomUUID(), expected_version: 0 })).toThrow();
  });

  it("cancel takes an optional reason of at most 500 characters; blank becomes null", () => {
    const base = { request_id: randomUUID(), expected_version: 1 };
    expect(OrderCancelSchema.parse(base).reason).toBeNull();
    expect(OrderCancelSchema.parse({ ...base, reason: "   " }).reason).toBeNull();
    expect(OrderCancelSchema.parse({ ...base, reason: " Pharmacy cancelled " }).reason).toBe("Pharmacy cancelled");
    expect(OrderCancelSchema.parse({ ...base, reason: "r".repeat(500) }).reason).toHaveLength(500);
    expect(() => OrderCancelSchema.parse({ ...base, reason: "r".repeat(501) })).toThrow();
  });
});

describe("OrderListQuerySchema", () => {
  it("has sensible defaults", () => {
    const parsed = OrderListQuerySchema.parse({});
    expect(parsed).toMatchObject({ q: "", limit: 50 });
    expect(parsed.status).toBeUndefined();
    expect(parsed.store_id).toBeUndefined();
  });

  it("accepts the filters", () => {
    const store = randomUUID();
    const parsed = OrderListQuerySchema.parse({ store_id: store, status: "draft", from: "2026-11-01", to: "2026-11-06", q: "ORD-0012", limit: "20", cursor: "50" });
    expect(parsed).toMatchObject({ store_id: store, status: "draft", from: "2026-11-01", to: "2026-11-06", q: "ORD-0012", limit: 20, cursor: "50" });
  });

  it("refuses unknown statuses, bad dates, a reversed range and a limit over 100", () => {
    expect(() => OrderListQuerySchema.parse({ status: "fulfilled" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ status: "shipped" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ from: "06-11-2026" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ from: "2026-02-30" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ from: "2026-11-07", to: "2026-11-06" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ limit: "101" })).toThrow();
    expect(() => OrderListQuerySchema.parse({ store_id: "x" })).toThrow();
  });
});
