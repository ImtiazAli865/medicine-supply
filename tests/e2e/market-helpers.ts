import { randomUUID } from "node:crypto";
import type { TestTenant } from "../helpers/supabase-test";
import { createOrder, seedStore } from "./orders-helpers";

// Shared set-up for the Module 005 browser tests: orders confirmed now belong to today's market list.

export interface MarketSeed {
  stores: { alMadina: string; shah: string; rehman: string };
  panadol500: string;
  panadol650: string;
  brufen: string;
}

async function medicine(tenant: TestTenant, fields: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const { error } = await tenant.client.from("products").insert({ id, unit: "strip", ...fields });
  if (error) throw new Error(`seed medicine: ${error.message}`);
  return id;
}

/**
 * The master prompt example: Panadol 500 mg ordered by Al Madina 20, Shah Medical 10 and Rehman Medical 15 (total 45),
 * a different strength of Panadol (650 mg), Brufen, a typed medicine in two stores (typed twice with different case
 * and spacing), and a draft with Panadol that must never count. The medicines have prices that must never be shown.
 */
export async function seedMarketDay(tenant: TestTenant): Promise<MarketSeed> {
  const alMadina = await seedStore(tenant, "Al Madina");
  const shah = await seedStore(tenant, "Shah Medical");
  const rehman = await seedStore(tenant, "Rehman Medical");
  const panadol500 = await medicine(tenant, { name: "Panadol", strength: "500 mg", dosage_form: "tablet", purchase_price: "90.00", selling_price: "125.50", mrp: "130.00" });
  const panadol650 = await medicine(tenant, { name: "Panadol", strength: "650 mg", dosage_form: "tablet", purchase_price: "95.00", selling_price: "140.00" });
  const brufen = await medicine(tenant, { name: "Brufen", strength: "400 mg", dosage_form: "tablet", purchase_price: "70.00", selling_price: "99.00" });
  await createOrder(tenant, alMadina, [{ product_id: panadol500, quantity: 20, unit: "strip" }, { product_id: brufen, quantity: 8, unit: "strip" }, { product_id: null, name: "Noran 20mg cap", quantity: 4, unit: "strip" }], { confirm: true });
  await createOrder(tenant, shah, [{ product_id: panadol500, quantity: 10, unit: "strip" }, { product_id: panadol650, quantity: 3, unit: "strip" }, { product_id: null, name: "noran  20MG cap", quantity: 6, unit: "strip" }], { confirm: true });
  await createOrder(tenant, rehman, [{ product_id: panadol500, quantity: 15, unit: "strip" }], { confirm: true });
  await createOrder(tenant, shah, [{ product_id: panadol500, quantity: 99, unit: "strip" }]); // a draft: never counted
  return { stores: { alMadina, shah, rehman }, panadol500, panadol650, brufen };
}

/** Today's Pakistan day, YYYY-MM-DD (the same rule as the app). */
export function todayInPakistan(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
