import { describe, expect, it } from "vitest";
import { SLIM_MEDICINE_KEYS } from "@/lib/orders/fast-types";
import { businessDbName, KEY_PATH, REGISTRY_DB_NAME, SCHEMA_UPGRADES, SCHEMA_VERSION, type PaymentOpRecord, type StoredMedicine } from "@/lib/device/schema";

const FORBIDDEN = /purchase|mrp|cost|margin|profit|balance|snapshot|invoice/i;

describe("device schema", () => {
  it("stores no price other than the selling price shown by the editor", () => {
    const sample: StoredMedicine = {
      id: "x",
      name: "n",
      unit: "strip",
      brand: null,
      generic_name: null,
      strength: null,
      dosage_form: null,
      manufacturer: null,
      pack_size: null,
      sku: null,
      selling_price: null,
    };
    for (const key of Object.keys(sample)) expect(key).not.toMatch(FORBIDDEN);
    expect(Object.keys(sample).sort()).toEqual([...SLIM_MEDICINE_KEYS].sort());
    // @ts-expect-error a purchase price can never be stored on the device
    const bad: StoredMedicine["purchase_price"] = undefined;
    expect(bad).toBeUndefined();
  });

  it("has an upgrade step for every version up to the current one", () => {
    for (let v = 1; v <= SCHEMA_VERSION; v += 1) expect(SCHEMA_UPGRADES[v]).toBeDefined();
    const all = Object.keys(SCHEMA_UPGRADES).flatMap((v) => SCHEMA_UPGRADES[Number(v)] ?? []);
    expect([...all].sort()).toEqual(Object.keys(KEY_PATH).sort());
    expect(new Set(all).size).toBe(all.length); // no store is created by two versions
  });

  it("adds the payment queue in version 2 and keeps version 1 as it was", () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(SCHEMA_UPGRADES[1]).toEqual(["meta", "medicines", "stores", "storeExtras", "drafts", "storeOps"]);
    expect(SCHEMA_UPGRADES[2]).toEqual(["paymentOps"]);
    expect(KEY_PATH.paymentOps).toBe("paymentId");
  });

  it("keeps no balance, invoice, ledger or price field on a waiting payment", () => {
    const sample: PaymentOpRecord = {
      paymentId: "p",
      rev: 1,
      seq: 1,
      storeId: "s",
      amount: "5000.00",
      date: "2026-11-24",
      reference: null,
      state: "waiting",
      reason: null,
      conflict: null,
      attempted: false,
      tries: 0,
      nextTryTick: 0,
      recordedOn: "2026-11-24T10:00:00Z",
    };
    for (const key of Object.keys(sample)) expect(key).not.toMatch(FORBIDDEN);
  });

  it("builds a business database name only from a valid business id", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(businessDbName(id)).toBe(`medsupply-${id}`);
    expect(businessDbName(id.toUpperCase())).toBe(`medsupply-${id}`);
    expect(businessDbName(id)).not.toBe(REGISTRY_DB_NAME);
    for (const bad of ["", "not-a-uuid", "../other", `${id}/x`, "medsupply-registry"]) {
      expect(() => businessDbName(bad)).toThrow();
    }
  });

  it("gives two businesses two different database names", () => {
    expect(businessDbName("123e4567-e89b-42d3-a456-426614174000")).not.toBe(businessDbName("123e4567-e89b-42d3-a456-426614174001"));
  });
});
