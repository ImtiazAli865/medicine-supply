import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { insertMedicine } from "../helpers/pending-db";
import { dbEntries, dbRecord, dbVoid, todayPkt } from "../helpers/market-db";

// Purchase entries and cancellations can only be added through the two functions. A signed-in user cannot
// insert, update or delete them directly, and nobody can change or remove a recorded row through the app.

const DAY = todayPkt();

let db: PGlite;
let a: Tenant;
let product: string;
let entryId: string;

const asA = <T>(fn: () => Promise<T>) => withRole(db, "authenticated", a.userId, fn);

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "append");
  product = await insertMedicine(db, a.businessId, { name: "Panadol", unit: "strip" });
  const entry = await dbRecord(db, a.userId, { product, date: DAY, quantity: 12, unit_cost: "90.00" });
  entryId = entry.entry!.id;
  await dbVoid(db, a.userId, entryId, "Typed wrongly");
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("a signed-in user cannot write the purchase tables directly", () => {
  it.each(["purchase_entries", "purchase_voids"])("refuses insert, update and delete on %s", async (table) => {
    await expect(asA(() => db.query(`delete from public.${table}`))).rejects.toThrow(/permission denied/);
    await expect(asA(() => db.query(`update public.${table} set business_id = business_id`))).rejects.toThrow(/permission denied/);
    const insert =
      table === "purchase_entries"
        ? `insert into public.purchase_entries (id, product_id, unit, purchase_date, quantity) values ('${randomUUID()}', '${product}', 'strip', '${DAY}', 1)`
        : `insert into public.purchase_voids (entry_id, reason) values ('${entryId}', 'again')`;
    await expect(asA(() => db.query(insert))).rejects.toThrow(/permission denied/);
  });

  it("refuses to change a recorded row even for the table owner (the trigger)", async () => {
    await expect(db.query(`update public.purchase_entries set quantity = 99 where id = $1`, [entryId])).rejects.toThrow(/purchase_entries_append_only/);
    await expect(db.query(`update public.purchase_voids set reason = 'Changed' where entry_id = $1`, [entryId])).rejects.toThrow(/purchase_voids_append_only/);
    await expect(db.query(`delete from public.purchase_voids where entry_id = $1`, [entryId])).rejects.toThrow(/purchase_voids_append_only/);
    await expect(db.query(`delete from public.purchase_entries where id = $1`, [entryId])).rejects.toThrow(/purchase_entries_append_only/);
  });
});

describe("a cancelled entry still exists", () => {
  it("is returned by the history with its reason, who and when, and the entry row is unchanged", async () => {
    const history = await dbEntries(db, a.userId, product, "strip", DAY);
    expect(history.found).toBe(true);
    if (!history.found) return;
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({
      id: entryId,
      quantity: 12,
      unit_cost: "90.00",
      recorded_by_me: true,
      cancelled: true,
      void: { reason: "Typed wrongly", by_me: true },
    });
    expect(typeof history.entries[0].void?.voided_at).toBe("string");
    expect(history.purchased).toBe(0);
    const row = await db.query<{ quantity: number }>(`select quantity from public.purchase_entries where id = $1`, [entryId]);
    expect(row.rows[0].quantity).toBe(12);
  });

  it("shows another business's user none of it, not even that the entry exists", async () => {
    const b = await createTenant(db, "append-b");
    const theirs = await withRole(db, "authenticated", b.userId, async () => {
      const entries = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_entries`);
      const voids = await db.query<{ n: number }>(`select count(*)::int as n from public.purchase_voids`);
      return { entries: entries.rows[0].n, voids: voids.rows[0].n };
    });
    expect(theirs).toEqual({ entries: 0, voids: 0 });
    expect(await dbEntries(db, b.userId, product, "strip", DAY)).toEqual({ found: false });
  });
});
