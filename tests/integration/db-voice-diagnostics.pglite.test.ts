import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createTestDb, withRole, type Tenant } from "../helpers/pglite";
import { dbDiagAdd, dbDiagList, dbParseAllow, rawDiagnostics } from "../helpers/voice-db";

// The diagnostic log and the AI parse limit on a real PostgreSQL engine: counts and length only (never a transcript, a
// key, a price or a balance), append-only, pruned after 90 days for the writer's own business only, and 20 AI parses per
// business per minute.

let db: PGlite;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, "voice-diag-a");
  b = await createTenant(db, "voice-diag-b");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("voice_diag_add", () => {
  it("appends one record with the kind, parser, counts, length and a short safe message", async () => {
    const res = await dbDiagAdd(db, a.userId, { kind: "ai_busy", parser: "ai", items: 3, doubtful: 1, unreadable: 0, length: 120, message: "  Service busy  " });
    expect(res).toEqual({ done: true });
    const rows = await rawDiagnostics(db, a.businessId);
    expect(rows).toEqual([{ kind: "ai_busy", transcript_length: 120, message: "Service busy" }]);
  });

  it("refuses a bad kind, parser, count, length or message and writes nothing", async () => {
    const before = (await rawDiagnostics(db, a.businessId)).length;
    expect(await dbDiagAdd(db, a.userId, { kind: "made_up" })).toMatchObject({ done: false, reason: "invalid_kind" });
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", parser: "robot" })).toMatchObject({ done: false, reason: "invalid_parser" });
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", items: 201 })).toMatchObject({ done: false, reason: "invalid_count" });
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", doubtful: -1 })).toMatchObject({ done: false, reason: "invalid_count" });
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", length: 2001 })).toMatchObject({ done: false, reason: "invalid_length" });
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", message: "x".repeat(201) })).toMatchObject({ done: false, reason: "invalid_message" });
    expect((await rawDiagnostics(db, a.businessId)).length).toBe(before);
    expect(await dbDiagAdd(db, a.userId, { kind: "ai_busy", message: "x".repeat(200), length: 2000, items: 200 })).toEqual({ done: true });
  });

  it("accepts every documented kind", async () => {
    for (const kind of ["ai_busy", "ai_timeout", "ai_invalid", "ai_not_configured", "ai_unavailable", "rules_unreadable", "low_confidence"]) {
      expect(await dbDiagAdd(db, a.userId, { kind }), kind).toEqual({ done: true });
    }
  });

  it("has no column that could hold the transcript, a key, a price or a balance", async () => {
    const cols = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'voice_diagnostics'`);
    expect(cols.rows.map((c) => c.column_name).sort()).toEqual(
      ["business_id", "created_at", "doubtful_count", "id", "item_count", "kind", "message", "parser", "transcript_length", "unreadable_count"].sort(),
    );
  });
});

describe("the rate_limited throttle", () => {
  it("skips a second rate_limited record within 60 seconds, but always writes other kinds", async () => {
    const t = await createTenant(db, "voice-diag-throttle");
    expect(await dbDiagAdd(db, t.userId, { kind: "rate_limited" })).toEqual({ done: true });
    expect(await dbDiagAdd(db, t.userId, { kind: "rate_limited" })).toEqual({ done: true, skipped: true });
    expect(await dbDiagAdd(db, t.userId, { kind: "rate_limited" })).toEqual({ done: true, skipped: true });
    expect(await dbDiagAdd(db, t.userId, { kind: "ai_busy" })).toEqual({ done: true });
    expect((await rawDiagnostics(db, t.businessId)).filter((r) => r.kind === "rate_limited")).toHaveLength(1);
  });

  it("writes a new rate_limited record once the earlier one is older than a minute", async () => {
    const t = await createTenant(db, "voice-diag-throttle-2");
    await db.query(`insert into public.voice_diagnostics (business_id, kind, parser, created_at) values ($1, 'rate_limited', 'ai', now() - interval '2 minutes')`, [t.businessId]);
    expect(await dbDiagAdd(db, t.userId, { kind: "rate_limited" })).toEqual({ done: true });
    expect((await rawDiagnostics(db, t.businessId)).filter((r) => r.kind === "rate_limited")).toHaveLength(2);
  });

  it("keeps the throttle per business", async () => {
    const t1 = await createTenant(db, "voice-diag-throttle-3");
    const t2 = await createTenant(db, "voice-diag-throttle-4");
    expect(await dbDiagAdd(db, t1.userId, { kind: "rate_limited" })).toEqual({ done: true });
    expect(await dbDiagAdd(db, t2.userId, { kind: "rate_limited" })).toEqual({ done: true });
  });
});

describe("pruning and append-only", () => {
  it("removes records older than 90 days of the writer's own business only", async () => {
    await db.query(`insert into public.voice_diagnostics (business_id, kind, parser, created_at) values ($1, 'ai_busy', 'ai', now() - interval '100 days'), ($2, 'ai_busy', 'ai', now() - interval '100 days')`, [a.businessId, b.businessId]);
    const oldOf = async (biz: string) =>
      Number((await db.query<{ c: string }>(`select count(*) as c from public.voice_diagnostics where business_id = $1 and created_at < now() - interval '90 days'`, [biz])).rows[0].c);
    expect(await oldOf(a.businessId)).toBe(1);
    await dbDiagAdd(db, a.userId, { kind: "ai_timeout" });
    expect(await oldOf(a.businessId)).toBe(0);
    expect(await oldOf(b.businessId)).toBe(1);
  });

  it("refuses to edit or delete a record for a signed-in user, whatever the setting", async () => {
    await withRole(db, "authenticated", a.userId, async () => {
      await expect(db.query(`update public.voice_diagnostics set message = 'x'`)).rejects.toThrow(/permission denied|immutable/i);
      await expect(db.query(`delete from public.voice_diagnostics`)).rejects.toThrow(/permission denied|immutable/i);
      await expect(db.query(`select set_config('app.voice_prune', 'on', true), (select 1 from (delete from public.voice_diagnostics returning 1) d)`)).rejects.toThrow();
    });
  });
});

describe("voice_diag_list", () => {
  it("lists the caller's records newest first with a total, a page size and an offset, and never another business's", async () => {
    const t = await createTenant(db, "voice-diag-list");
    for (let i = 1; i <= 5; i += 1) {
      await db.query(`insert into public.voice_diagnostics (business_id, kind, parser, item_count, created_at) values ($1, 'low_confidence', 'ai', $2, now() - make_interval(mins => $2))`, [t.businessId, i]);
    }
    const page = await dbDiagList(db, t.userId, 2, 0);
    expect(page.total).toBe(5);
    expect(page.items.map((r) => r.item_count)).toEqual([1, 2]);
    expect((await dbDiagList(db, t.userId, 2, 2)).items.map((r) => r.item_count)).toEqual([3, 4]);
    expect((await dbDiagList(db, t.userId, 2, 4)).items.map((r) => r.item_count)).toEqual([5]);
    expect((await dbDiagList(db, t.userId, 500, 0)).items).toHaveLength(5);
    expect((await dbDiagList(db, b.userId, 50, 0)).items.every((r) => r.kind !== undefined)).toBe(true);
    const other = await createTenant(db, "voice-diag-list-other");
    expect(await dbDiagList(db, other.userId, 50, 0)).toEqual({ total: 0, items: [] });
  });
});

describe("voice_parse_allow", () => {
  it("allows 20 AI parses a minute, refuses the 21st with a wait time, and allows again after the minute", async () => {
    const t = await createTenant(db, "voice-allow-a");
    for (let i = 0; i < 20; i += 1) expect(await dbParseAllow(db, t.userId), `parse ${i + 1}`).toEqual({ allowed: true });
    const refused = await dbParseAllow(db, t.userId);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(60);
    // a refused request is not counted
    const count = async () => Number((await db.query<{ c: string }>(`select count(*) as c from public.voice_parse_attempts where business_id = $1`, [t.businessId])).rows[0].c);
    expect(await count()).toBe(20);
    // after the minute it is allowed again
    await db.query(`update public.voice_parse_attempts set at = now() - interval '61 seconds' where business_id = $1`, [t.businessId]);
    expect(await dbParseAllow(db, t.userId)).toEqual({ allowed: true });
  });

  it("keeps businesses apart", async () => {
    const t1 = await createTenant(db, "voice-allow-b1");
    const t2 = await createTenant(db, "voice-allow-b2");
    for (let i = 0; i < 20; i += 1) await dbParseAllow(db, t1.userId);
    expect((await dbParseAllow(db, t1.userId)).allowed).toBe(false);
    expect(await dbParseAllow(db, t2.userId)).toEqual({ allowed: true });
  });

  it("forgets attempts older than an hour, and the table cannot be read or written by a signed-in user", async () => {
    const t = await createTenant(db, "voice-allow-c");
    await db.query(`insert into public.voice_parse_attempts (business_id, at) values ($1, now() - interval '2 hours')`, [t.businessId]);
    expect(await dbParseAllow(db, t.userId)).toEqual({ allowed: true });
    const left = Number((await db.query<{ c: string }>(`select count(*) as c from public.voice_parse_attempts where business_id = $1 and at < now() - interval '1 hour'`, [t.businessId])).rows[0].c);
    expect(left).toBe(0);
    await withRole(db, "authenticated", t.userId, async () => {
      await expect(db.query(`select * from public.voice_parse_attempts`)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`insert into public.voice_parse_attempts (business_id) values ($1)`, [t.businessId])).rejects.toThrow(/permission denied/i);
    });
  });
});
