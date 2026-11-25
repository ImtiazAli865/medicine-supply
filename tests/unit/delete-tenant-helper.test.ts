import { beforeEach, describe, expect, it } from "vitest";
import { assertCleaned, cleanBusiness, discoverTables, forgetDiscoveredTables, KNOWN_TABLE_ORDER, type CleanupClient, type DbError } from "../helpers/tenant-cleanup";

// The honest test clean-up (Module 011, T048): it finds the tables itself, retries a table that another still references, deletes in
// batches when a delete times out, and never reports success while something is left.

interface Row {
  id: string;
  business_id: string;
}

/** A small database: tables of rows, "child references parent" rules, timeouts and failures. */
class FakeDb {
  tables = new Map<string, Row[]>();
  /** Tables the audit reports as carrying a business id. */
  audited: string[] = [];
  /** [child, parent]: a parent's rows cannot be deleted while a child still has rows of the same business. */
  refs: Array<[string, string]> = [];
  /** A delete of more than this many rows in one statement times out. */
  timeoutOver = new Map<string, number>();
  failing = new Map<string, DbError>();
  absent = new Set<string>();
  rpcCalls = 0;
  deletes: string[] = [];
  users = new Set<string>(["user-1"]);
  authError: DbError | null = null;

  add(table: string, business: string, count: number) {
    const rows = this.tables.get(table) ?? [];
    for (let i = 0; i < count; i += 1) rows.push({ id: `${table}-${business}-${rows.length}`, business_id: business });
    this.tables.set(table, rows);
  }

  count(table: string, business: string): number {
    return (this.tables.get(table) ?? []).filter((r) => r.business_id === business).length;
  }

  private removeRows(table: string, predicate: (row: Row) => boolean): { error: DbError | null; data?: null } {
    this.deletes.push(table);
    if (this.absent.has(table)) return { error: { message: `Could not find the table 'public.${table}'`, code: "PGRST205" } };
    const failure = this.failing.get(table);
    if (failure) return { error: failure };
    const rows = this.tables.get(table) ?? [];
    const hit = rows.filter(predicate);
    for (const [child, parent] of this.refs) {
      if (parent === table && hit.some((p) => (this.tables.get(child) ?? []).some((c) => c.business_id === p.business_id))) {
        return { error: { message: `update or delete on table "${table}" violates foreign key constraint from "${child}"`, code: "23503" } };
      }
    }
    const limit = this.timeoutOver.get(table);
    if (limit !== undefined && hit.length > limit) return { error: { message: "canceling statement due to statement timeout", code: "57014" } };
    this.tables.set(table, rows.filter((r) => !predicate(r)));
    return { error: null };
  }

  client(): CleanupClient {
    return {
      rpc: async () => {
        this.rpcCalls += 1;
        return { data: this.audited.map((table_name) => ({ table_name, has_business_id: true })).concat([{ table_name: "businesses", has_business_id: false }]), error: null };
      },
      from: (table: string) => ({
        delete: () => ({
          eq: async (column: string, value: string) => this.removeRows(table, (r) => (column === "id" ? r.id : r.business_id) === value),
          in: async (_column: string, values: string[]) => this.removeRows(table, (r) => values.includes(r.id)),
        }),
        select: (columns: string) => ({
          eq: (column: string, value: string) => ({
            limit: async (rows: number) => {
              if (this.absent.has(table)) return { data: null, error: { message: "Could not find the table", code: "PGRST205" } };
              const found = (this.tables.get(table) ?? []).filter((r) => (column === "id" ? r.id : r.business_id) === value).slice(0, rows);
              return { data: found.map((r) => ({ [columns]: columns === "id" ? r.id : r.business_id })), error: null };
            },
          }),
        }),
      }),
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            if (this.authError) return { error: this.authError };
            if (!this.users.has(id)) return { error: { message: "User not found", code: "user_not_found" } };
            this.users.delete(id);
            return { error: null };
          },
        },
      },
    };
  }
}

const BIZ = "biz-1";
const target = { businessId: BIZ, userId: "user-1" };

let db: FakeDb;

beforeEach(() => {
  forgetDiscoveredTables();
  db = new FakeDb();
  db.audited = ["orders", "order_lines", "stores", "business_settings", "voice_parse_attempts", "voice_diagnostics", "profiles"];
  db.tables.set("businesses", [{ id: BIZ, business_id: BIZ }]);
  for (const t of db.audited) db.add(t, BIZ, 2);
});

describe("finding the tables itself", () => {
  it("lists the tables that carry a business id from the project's own audit, unknown ones first, known ones children before parents", async () => {
    const tables = await discoverTables(db.client());
    expect(tables.slice(0, 2)).toEqual(["voice_diagnostics", "voice_parse_attempts"]);
    expect(tables.slice(2)).toEqual(KNOWN_TABLE_ORDER.filter((t) => db.audited.includes(t)));
    expect(tables).not.toContain("businesses");
  });

  it("asks the audit once per process and keeps the answer", async () => {
    await cleanBusiness(db.client(), target);
    db.add("orders", "biz-2", 1);
    db.users.add("user-2");
    await cleanBusiness(db.client(), { businessId: "biz-2", userId: "user-2" });
    expect(db.rpcCalls).toBe(1);
  });

  it("fails loudly when the table list cannot be read", async () => {
    const broken: CleanupClient = { ...db.client(), rpc: async () => ({ data: null, error: { message: "permission denied" } }) };
    await expect(cleanBusiness(broken, target)).rejects.toThrow(/could not list the tables.*permission denied/);
  });
});

describe("cleaning a business", () => {
  it("removes business_settings, a table it never knew (a stand-in for the voice tables), the business row and the user", async () => {
    await cleanBusiness(db.client(), target);
    for (const t of db.audited) expect(db.count(t, BIZ), t).toBe(0);
    expect(db.count("businesses", BIZ)).toBe(0);
    expect(db.users.has("user-1")).toBe(false);
  });

  it("costs one plain delete per table for a small business, and no batches", async () => {
    await cleanBusiness(db.client(), target);
    // seven tables, the business row: one delete statement each
    expect(db.deletes).toHaveLength(db.audited.length + 1);
  });

  it("retries a table that another still references, in a later pass, and then succeeds", async () => {
    forgetDiscoveredTables();
    db.audited = [...db.audited, "unknown_parent"];
    db.add("unknown_parent", BIZ, 1);
    db.refs.push(["products", "unknown_parent"]); // products rows point at unknown_parent rows
    db.audited.push("products");
    db.add("products", BIZ, 3);
    await cleanBusiness(db.client(), target);
    expect(db.count("unknown_parent", BIZ)).toBe(0);
    expect(db.count("products", BIZ)).toBe(0);
    expect(db.count("businesses", BIZ)).toBe(0);
  });

  it("can be called again when nothing is left", async () => {
    await cleanBusiness(db.client(), target);
    await expect(cleanBusiness(db.client(), target)).resolves.toBeUndefined();
  });

  it("skips a table the project does not have (an older project) without an error", async () => {
    db.absent.add("voice_diagnostics");
    await expect(cleanBusiness(db.client(), target)).resolves.toBeUndefined();
  });

  it("removes a business that has no user (an orphan) without touching the user service", async () => {
    await cleanBusiness(db.client(), { businessId: BIZ, userId: null });
    expect(db.count("businesses", BIZ)).toBe(0);
    expect(db.users.has("user-1")).toBe(true);
  });

  it("works with no business at all (an account made without one): only the user is removed", async () => {
    await cleanBusiness(db.client(), { businessId: null, userId: "user-1" });
    expect(db.users.has("user-1")).toBe(false);
    expect(db.rpcCalls).toBe(0);
  });
});

describe("never silent", () => {
  it("throws one error naming every table that could not be cleaned, with its message", async () => {
    db.failing.set("order_lines", { message: "permission denied for table order_lines", code: "42501" });
    db.failing.set("voice_diagnostics", { message: "something else broke" });
    const error = await cleanBusiness(db.client(), target).then(
      () => null,
      (e: Error) => e,
    );
    expect(error).not.toBeNull();
    expect(error!.message).toContain("could not be removed completely");
    expect(error!.message).toContain("order_lines: permission denied for table order_lines");
    expect(error!.message).toContain("voice_diagnostics: something else broke");
    // it still cleaned everything it could
    expect(db.count("stores", BIZ)).toBe(0);
    expect(db.count("orders", BIZ)).toBe(0);
  });

  it("stops when a pass makes no progress instead of repeating the same errors", async () => {
    db.failing.set("stores", { message: "boom" });
    await expect(cleanBusiness(db.client(), target)).rejects.toThrow(/stores: boom/);
    const storeAttempts = db.deletes.filter((t) => t === "stores").length;
    expect(storeAttempts).toBeLessThanOrEqual(2);
  });

  it("throws when the business row cannot be deleted because something that points at it is left", async () => {
    db.refs.push(["leftover_log", "businesses"]);
    db.add("leftover_log", BIZ, 1); // a table the audit does not list, still holding a row of the business
    await expect(cleanBusiness(db.client(), target)).rejects.toThrow(/businesses: .*foreign key/);
    expect(db.count("businesses", BIZ)).toBe(1);
  });

  it("throws when the user cannot be deleted, but not when the user is already gone", async () => {
    await cleanBusiness(db.client(), target);
    db.add("orders", BIZ, 1);
    db.authError = { message: "internal error", code: "unexpected_failure" };
    db.users.add("user-1");
    await expect(cleanBusiness(db.client(), target)).rejects.toThrow(/auth user: internal error/);
    db.authError = null;
    db.users.clear();
    await expect(cleanBusiness(db.client(), target)).resolves.toBeUndefined();
  });
});

describe("a table too large to delete at once", () => {
  it("halves the batch when a delete times out and finally removes every row", async () => {
    forgetDiscoveredTables();
    db.add("orders", BIZ, 1_200);
    db.timeoutOver.set("orders", 100);
    await cleanBusiness(db.client(), target);
    expect(db.count("orders", BIZ)).toBe(0);
    expect(db.deletes.filter((t) => t === "orders").length).toBeGreaterThan(5);
  });

  it("gives up with the error when even one row at a time times out", async () => {
    db.add("orders", BIZ, 50);
    db.timeoutOver.set("orders", 0);
    await expect(cleanBusiness(db.client(), target)).rejects.toThrow(/orders: .*timeout/);
  });
});

describe("proving a scale test left nothing", () => {
  it("passes for a clean project and names what is left otherwise", async () => {
    await cleanBusiness(db.client(), target);
    await expect(assertCleaned(db.client(), BIZ)).resolves.toBeUndefined();
    db.add("order_lines", BIZ, 3);
    db.tables.set("businesses", [{ id: BIZ, business_id: BIZ }]);
    await expect(assertCleaned(db.client(), BIZ)).rejects.toThrow(/order_lines: rows are left.*businesses: the business row is left/);
  });
});
