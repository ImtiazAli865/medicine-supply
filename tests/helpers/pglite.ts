import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

/**
 * A real PostgreSQL engine (PGlite, WASM) with a minimal imitation of the Supabase pieces the
 * migration relies on: the anon/authenticated/service_role roles, auth.users, auth.uid(), and the
 * extensions schema. It lets the migration, constraints, triggers and Row Level Security be tested
 * without Docker or credentials. It is NOT the Supabase stack: PostgREST, GoTrue and the real
 * role setup are only exercised by the integration tests that run against a Supabase test project.
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });

  await db.exec(`
    create schema if not exists extensions;
    create schema if not exists auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;

    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique
    );

    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);

  const migration = readFileSync(path.resolve("supabase/migrations/0001_init.sql"), "utf8");
  await db.exec(migration);
  return db;
}

export type Role = "anon" | "authenticated" | "service_role";

/** Runs `fn` as the given role and user, the way PostgREST does for a request. Always resets. */
export async function withRole<T>(db: PGlite, role: Role, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export interface Tenant {
  userId: string;
  businessId: string;
}

/** Creates an auth user, a business and the profile linking them (what provision-owner.sql does). */
export async function createTenant(db: PGlite, label: string): Promise<Tenant> {
  const user = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [
    `${label}@example.test`,
  ]);
  const business = await db.query<{ id: string }>(`insert into public.businesses (name) values ($1) returning id`, [
    `${label} business`,
  ]);
  const userId = user.rows[0].id;
  const businessId = business.rows[0].id;
  await db.query(`insert into public.profiles (user_id, business_id) values ($1, $2)`, [userId, businessId]);
  return { userId, businessId };
}
