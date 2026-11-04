import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, notFound, unusableId } from "@/lib/api/errors";
import { decodeCursor, isUniqueViolation, slicePage } from "@/lib/api/paging";
import { canonicalMoney, compareMoney, subtractMoney } from "@/lib/money";
import { escapeLike, norm, searchTokens } from "@/lib/normalize";
import type { ListQuery } from "@/lib/validation/store";
import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validation/product";
import type { Product, ProductPage, ProductResult, ProductWarning } from "./types";

// Money columns are cast to text so exact decimals reach us as strings, never as floats.
const COLUMNS =
  "id,name,unit,brand,generic_name,strength,dosage_form,manufacturer,pack_size,sku," +
  "purchase_price::text,selling_price::text,mrp::text,is_active,version,created_at,updated_at";

function money(value: unknown): string | null {
  if (value == null) return null;
  // Tolerate a number too (older API behavior): String() of a 2-decimal value is exact for our range.
  return canonicalMoney(String(value));
}

export function toProduct(row: Record<string, unknown>): Product {
  const purchase = money(row.purchase_price);
  const selling = money(row.selling_price);
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as string,
    brand: (row.brand as string | null) ?? null,
    generic_name: (row.generic_name as string | null) ?? null,
    strength: (row.strength as string | null) ?? null,
    dosage_form: (row.dosage_form as string | null) ?? null,
    manufacturer: (row.manufacturer as string | null) ?? null,
    pack_size: (row.pack_size as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    purchase_price: purchase,
    selling_price: selling,
    mrp: money(row.mrp),
    unit_gross_profit: subtractMoney(selling, purchase),
    is_active: row.is_active as boolean,
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Non-blocking advisories about the entered prices. */
export function priceWarnings(p: Pick<Product, "purchase_price" | "selling_price" | "mrp">): ProductWarning[] {
  const warnings: ProductWarning[] = [];
  if (compareMoney(p.selling_price, p.purchase_price) === -1) warnings.push("selling_below_purchase");
  if (compareMoney(p.mrp, p.selling_price) === -1) warnings.push("mrp_below_selling");
  return warnings;
}

type IdentityFields = Pick<Product, "name" | "strength" | "dosage_form" | "pack_size" | "manufacturer">;

/** Same medicine identity (ignoring case and spacing). The unit is deliberately not compared. */
export function sameIdentity(a: IdentityFields, b: IdentityFields): boolean {
  return (
    norm(a.name) === norm(b.name) &&
    norm(a.strength) === norm(b.strength) &&
    norm(a.dosage_form) === norm(b.dosage_form) &&
    norm(a.pack_size) === norm(b.pack_size) &&
    norm(a.manufacturer) === norm(b.manufacturer)
  );
}

export async function listProducts(supabase: SupabaseClient, query: ListQuery): Promise<ProductPage> {
  const offset = decodeCursor(query.cursor);
  let request = supabase.from("products").select(COLUMNS);

  if (query.status === "active") request = request.eq("is_active", true);
  if (query.status === "inactive") request = request.eq("is_active", false);

  for (const token of searchTokens(query.q)) {
    request = request.ilike("search_text", `%${escapeLike(token)}%`);
  }

  const { data, error } = await request
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + query.limit); // limit + 1 rows
  if (error) throw error;

  return slicePage(((data ?? []) as unknown as Record<string, unknown>[]).map(toProduct), offset, query.limit);
}

export async function getProduct(supabase: SupabaseClient, id: string): Promise<Product | null> {
  const { data, error } = await supabase.from("products").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toProduct(data as unknown as Record<string, unknown>) : null;
}

/** Products of the caller's business with the same normalized name (active and inactive). */
export async function findProductsByName(
  supabase: SupabaseClient,
  name: string,
  excludeId?: string,
): Promise<Product[]> {
  const { data, error } = await supabase.rpc("find_products_by_name", { p_name: name, p_exclude: excludeId ?? null });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toProduct);
}

async function findBySku(supabase: SupabaseClient, sku: string, excludeId?: string): Promise<Product | null> {
  let request = supabase.from("products").select(COLUMNS).ilike("sku", escapeLike(sku.trim()));
  if (excludeId) request = request.neq("id", excludeId);
  const { data, error } = await request.limit(1);
  if (error) throw error;
  return data && data.length > 0 ? toProduct(data[0] as unknown as Record<string, unknown>) : null;
}

/**
 * Throws 409 when the final values duplicate an existing product exactly (blocked), or look like
 * another strength/form/pack of the same name (needs explicit confirmation).
 */
async function checkIdentity(
  supabase: SupabaseClient,
  final: IdentityFields,
  excludeId: string | undefined,
  confirmSimilar: boolean,
): Promise<void> {
  const candidates = await findProductsByName(supabase, final.name, excludeId);
  const exact = candidates.filter((c) => sameIdentity(c, final));
  if (exact.length > 0) {
    throw new ApiError("duplicate_product", "This medicine already exists.", { matches: exact });
  }
  if (candidates.length > 0 && !confirmSimilar) {
    throw new ApiError("similar_products", "Similar medicines already exist. Confirm to create a separate product.", {
      matches: candidates,
    });
  }
}

/** Maps database unique violations (races) to the same friendly errors as the pre-checks. */
async function mapUniqueViolation(
  supabase: SupabaseClient,
  error: { code?: string; message: string; details?: string | null; hint?: string | null },
  final: IdentityFields & { sku: string | null },
  excludeId: string | undefined,
): Promise<never> {
  const pgError = { name: "PostgrestError", ...error } as Parameters<typeof isUniqueViolation>[0];
  if (isUniqueViolation(pgError, "products_sku_uniq") && final.sku) {
    const conflicting = await findBySku(supabase, final.sku, excludeId);
    throw new ApiError("sku_conflict", `This SKU is already used by ${conflicting?.name ?? "another product"}.`, {
      matches: conflicting ? [conflicting] : [],
      fields: { sku: "This SKU is already used by another product." },
    });
  }
  if (isUniqueViolation(pgError, "products_identity_uniq")) {
    const candidates = await findProductsByName(supabase, final.name, excludeId);
    throw new ApiError("duplicate_product", "This medicine already exists.", {
      matches: candidates.filter((c) => sameIdentity(c, final)),
    });
  }
  throw error;
}

export async function createProduct(
  supabase: SupabaseClient,
  input: ProductCreateInput,
): Promise<{ result: ProductResult; created: boolean }> {
  // Idempotent retry: the same id for the same business returns the stored record.
  const existing = await getProduct(supabase, input.id);
  if (existing) return { result: { product: existing, warnings: priceWarnings(existing) }, created: false };

  if (input.sku) {
    const conflicting = await findBySku(supabase, input.sku);
    if (conflicting) {
      throw new ApiError("sku_conflict", `This SKU is already used by ${conflicting.name}.`, {
        matches: [conflicting],
        fields: { sku: `This SKU is already used by ${conflicting.name}.` },
      });
    }
  }
  await checkIdentity(supabase, input, undefined, input.confirm_similar);

  const { confirm_similar: _ignored, ...row } = input;
  void _ignored;
  const { data, error } = await supabase.from("products").insert(row).select(COLUMNS).single();
  if (error) {
    if (error.code === "23505") {
      // Either a concurrent retry created it, a race on identity/SKU, or the id belongs to someone else.
      const again = await getProduct(supabase, input.id);
      if (again) return { result: { product: again, warnings: priceWarnings(again) }, created: false };
      if (isUniqueViolation(error, "products_pkey")) throw unusableId();
      await mapUniqueViolation(supabase, error, input, undefined);
    }
    throw error;
  }
  const product = toProduct(data as unknown as Record<string, unknown>);
  return { result: { product, warnings: priceWarnings(product) }, created: true };
}

export async function updateProduct(
  supabase: SupabaseClient,
  id: string,
  input: ProductUpdateInput,
): Promise<ProductResult> {
  const { expected_version, confirm_similar, ...fields } = input;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError("validation_error", "Nothing to change.", { fields: { _: "Nothing to change." } });
  }

  const current = await getProduct(supabase, id);
  if (!current) throw notFound();
  if (current.version !== expected_version) {
    throw new ApiError("version_conflict", "This product was changed elsewhere.", { current });
  }

  const final = { ...current, ...patch } as Product;
  const identityChanged = !sameIdentity(current, final);
  const skuChanged = norm(current.sku) !== norm(final.sku);

  if (skuChanged && final.sku) {
    const conflicting = await findBySku(supabase, final.sku, id);
    if (conflicting) {
      throw new ApiError("sku_conflict", `This SKU is already used by ${conflicting.name}.`, {
        matches: [conflicting],
        fields: { sku: `This SKU is already used by ${conflicting.name}.` },
      });
    }
  }
  // Reactivating or editing unrelated fields never re-triggers the similar-product prompt.
  if (identityChanged) await checkIdentity(supabase, final, id, confirm_similar);

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", id)
    .eq("version", expected_version)
    .select(COLUMNS);
  if (error) {
    if (error.code === "23505") await mapUniqueViolation(supabase, error, final, id);
    throw error;
  }

  if (data && data.length === 1) {
    const product = toProduct(data[0] as unknown as Record<string, unknown>);
    return { product, warnings: priceWarnings(product) };
  }

  // Changed between our read and write.
  const latest = await getProduct(supabase, id);
  if (!latest) throw notFound();
  throw new ApiError("version_conflict", "This product was changed elsewhere.", { current: latest });
}
