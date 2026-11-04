import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, notFound, unusableId } from "@/lib/api/errors";
import { decodeCursor, isAnyUniqueViolation, slicePage } from "@/lib/api/paging";
import { escapeLike, searchTokens } from "@/lib/normalize";
import type { ListQuery, StoreCreateInput, StoreUpdateInput } from "@/lib/validation/store";
import type { Store, StorePage } from "./types";

// Explicit column list: never `select *`, and business_id is never sent to clients.
const COLUMNS = "id,name,contact_person,phone,address,notes,is_active,version,created_at,updated_at";

function toStore(row: Record<string, unknown>): Store {
  return {
    id: row.id as string,
    name: row.name as string,
    contact_person: (row.contact_person as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    is_active: row.is_active as boolean,
    version: row.version as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function listStores(supabase: SupabaseClient, query: ListQuery): Promise<StorePage> {
  const offset = decodeCursor(query.cursor);
  let request = supabase.from("stores").select(COLUMNS);

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

  const page = slicePage((data ?? []).map(toStore), offset, query.limit);
  return page;
}

export async function getStore(supabase: SupabaseClient, id: string): Promise<Store | null> {
  const { data, error } = await supabase.from("stores").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toStore(data) : null;
}

/** Stores of the caller's business whose normalized name equals `name`. */
export async function findStoresByName(supabase: SupabaseClient, name: string, excludeId?: string): Promise<Store[]> {
  const { data, error } = await supabase.rpc("find_stores_by_name", { p_name: name, p_exclude: excludeId ?? null });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toStore);
}

export async function createStore(
  supabase: SupabaseClient,
  input: StoreCreateInput,
): Promise<{ store: Store; created: boolean }> {
  // Idempotent retry: the same id for the same business returns the stored record.
  const existing = await getStore(supabase, input.id);
  if (existing) return { store: existing, created: false };

  if (!input.confirm_duplicate) {
    const similar = await findStoresByName(supabase, input.name);
    if (similar.length > 0) {
      throw new ApiError("similar_store", "A store with this name already exists.", { matches: similar });
    }
  }

  const { confirm_duplicate: _ignored, ...row } = input;
  void _ignored;
  const { data, error } = await supabase.from("stores").insert(row).select(COLUMNS).single();
  if (error) {
    if (isAnyUniqueViolation(error)) {
      // A concurrent retry may have just created it, or the id belongs to someone else.
      const again = await getStore(supabase, input.id);
      if (again) return { store: again, created: false };
      throw unusableId();
    }
    throw error;
  }
  return { store: toStore(data), created: true };
}

export async function updateStore(supabase: SupabaseClient, id: string, input: StoreUpdateInput): Promise<Store> {
  const { expected_version, confirm_duplicate, ...fields } = input;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiError("validation_error", "Nothing to change.", { fields: { _: "Nothing to change." } });
  }

  if (patch.name !== undefined && !confirm_duplicate) {
    const similar = await findStoresByName(supabase, patch.name as string, id);
    if (similar.length > 0) {
      throw new ApiError("similar_store", "Another store has this name.", { matches: similar });
    }
  }

  const { data, error } = await supabase
    .from("stores")
    .update(patch)
    .eq("id", id)
    .eq("version", expected_version)
    .select(COLUMNS);
  if (error) throw error;

  if (data && data.length === 1) return toStore(data[0]);

  // No row updated: it either does not exist for this business, or it changed since it was opened.
  const current = await getStore(supabase, id);
  if (!current) throw notFound();
  throw new ApiError("version_conflict", "This store was changed elsewhere.", { current });
}
