// The honest clean-up of a test business (Module 011, T048/T052). It is used by the shared `deleteTenant` helper and by the sweep
// script, and it has no dependency on the Supabase package: it works on the small client interface below, so it is unit-tested
// with a fake database.
//
// The old helper deleted a fixed list of tables and ignored every error. It never knew `business_settings` or the tables of the
// dropped voice work, so the business row could never be deleted and hundreds of test businesses were left behind, unseen.
// This one DISCOVERS the tables that carry a business id (from the project's own `rls_audit()` function), deletes them in
// passes (a table that another still references is retried after the others), deletes in batches when a delete times out, and
// FAILS LOUDLY: if anything is left, it throws one error that names every table and its message.

export interface DbError {
  message: string;
  code?: string;
}

type Result<T = unknown> = PromiseLike<{ data?: T | null; error: DbError | null }>;

/** The few calls the clean-up needs. A Supabase client (cast) and the fake of the unit test both have this shape. */
export interface CleanupClient {
  rpc(fn: "rls_audit"): Result<Array<{ table_name: string; has_business_id: boolean }>>;
  from(table: string): {
    delete(): { eq(column: string, value: string): Result; in(column: string, values: string[]): Result };
    select(columns: string): { eq(column: string, value: string): { limit(rows: number): Result<Array<Record<string, string>>> } };
  };
  auth: { admin: { deleteUser(id: string): Result } };
}

/** Tables that are known to hold a business's rows, children before parents. Unknown tables found by the audit go first. */
export const KNOWN_TABLE_ORDER = [
  "ledger_entries",
  "invoice_events",
  "invoice_lines",
  "invoices",
  "invoice_counters",
  "purchase_voids",
  "purchase_entries",
  "pending_requests",
  "order_events",
  "order_lines",
  "orders",
  "order_counters",
  "products",
  "imports",
  "stores",
  "business_settings",
  "profiles",
] as const;

const FIRST_BATCH = 500;
const MAX_PASSES = 8;

export function isTimeout(error: DbError): boolean {
  return error.code === "57014" || /timeout|timed out|canceling statement/i.test(error.message);
}

/** A table the project does not have (an older project, before a migration): nothing to delete there. */
export function isMissingTable(error: DbError): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message);
}

let discovered: string[] | null = null;

/** The tables of this project that carry a business id, read once from `rls_audit()` and kept for the process. */
export async function discoverTables(client: CleanupClient, refresh = false): Promise<string[]> {
  if (discovered && !refresh) return discovered;
  const audit = await client.rpc("rls_audit");
  if (audit.error || !Array.isArray(audit.data)) {
    throw new Error(`The clean-up could not list the tables of the project (rls_audit): ${audit.error?.message ?? "no answer"}`);
  }
  const found = audit.data.filter((row) => row.has_business_id).map((row) => row.table_name);
  const known = new Set<string>(KNOWN_TABLE_ORDER);
  const unknown = found.filter((name) => !known.has(name)).sort();
  const ordered = [...unknown, ...KNOWN_TABLE_ORDER.filter((name) => found.includes(name))];
  discovered = ordered;
  return ordered;
}

/** For the unit tests: forget the cached list. */
export function forgetDiscoveredTables(): void {
  discovered = null;
}

/**
 * Deletes every row of a table for one business. A plain delete first; when it times out, in batches of at most 500 ids that
 * halve on each timeout. Returns the error that stopped it, or null when the table is empty for this business.
 */
async function deleteRows(client: CleanupClient, table: string, column: string, value: string): Promise<DbError | null> {
  const plain = await client.from(table).delete().eq(column, value);
  if (!plain.error || isMissingTable(plain.error)) return null;
  if (!isTimeout(plain.error)) return plain.error;

  let size = FIRST_BATCH;
  for (let guard = 0; guard < 200_000; guard += 1) {
    const found = await client.from(table).select("id").eq(column, value).limit(size);
    if (found.error) return isMissingTable(found.error) ? null : found.error;
    const ids = (found.data ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
    if (ids.length === 0) return null;
    const removed = await client.from(table).delete().in("id", ids);
    if (!removed.error) continue;
    if (isTimeout(removed.error) && size > 1) {
      size = Math.max(1, Math.floor(size / 2));
      continue;
    }
    return removed.error;
  }
  return { message: "gave up: the rows kept coming back after more than 200,000 batches" };
}

export interface CleanupTarget {
  businessId: string | null;
  userId: string;
}

/**
 * Removes a test business and its user. Every table with a business id is cleaned (in passes), then the business row, then the
 * user. Throws ONE error listing every table that could not be cleaned and why; never reports success while something is left.
 * Safe to call again when nothing is left.
 */
export async function cleanBusiness(client: CleanupClient, target: CleanupTarget): Promise<void> {
  const errors = new Map<string, string>();

  if (target.businessId) {
    const tables = await discoverTables(client);
    let pending = [...tables];
    for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass += 1) {
      const stillPending: string[] = [];
      for (const table of pending) {
        const error = await deleteRows(client, table, "business_id", target.businessId);
        if (error) {
          errors.set(table, error.message);
          stillPending.push(table);
        } else {
          errors.delete(table);
        }
      }
      if (stillPending.length === pending.length) break; // no progress in this pass: more passes would only repeat the errors
      pending = stillPending;
    }

    const business = await deleteRows(client, "businesses", "id", target.businessId);
    if (business) errors.set("businesses", business.message);
  }

  const user = await client.auth.admin.deleteUser(target.userId);
  if (user.error && !/not found|user_not_found/i.test(`${user.error.code ?? ""} ${user.error.message}`)) errors.set("auth user", user.error.message);

  if (errors.size > 0) {
    const lines = [...errors].map(([table, message]) => `${table}: ${message}`);
    throw new Error(`The test business could not be removed completely. Left behind: ${lines.join("; ")}`);
  }
}

/**
 * Throws when anything of the business is still there: a row in any table that carries its id, or its business row. Used by the
 * scale tests after their own clean-up, so a test that seeded thousands of rows proves it left none.
 */
export async function assertCleaned(client: CleanupClient, businessId: string): Promise<void> {
  const left: string[] = [];
  for (const table of await discoverTables(client)) {
    const rows = await client.from(table).select("business_id").eq("business_id", businessId).limit(1);
    if (rows.error) {
      if (!isMissingTable(rows.error)) left.push(`${table}: could not be read (${rows.error.message})`);
    } else if ((rows.data ?? []).length > 0) {
      left.push(`${table}: rows are left`);
    }
  }
  const business = await client.from("businesses").select("id").eq("id", businessId).limit(1);
  if (!business.error && (business.data ?? []).length > 0) left.push("businesses: the business row is left");
  if (left.length > 0) throw new Error(`The test business was not cleaned up. ${left.join("; ")}`);
}
