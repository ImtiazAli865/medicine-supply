import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helpers for tests that run against a dedicated TEST Supabase project (never real business data).
// The service-role key is read from the environment only (.env.test.local, git-ignored). It is used
// here, in test code, to create users and to clean up; it is never used by the app in src/.

const url = process.env.SUPABASE_TEST_URL ?? "";
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";

export const hasTestEnv = Boolean(url && anonKey && serviceKey);

export const SKIP_REASON =
  "Skipped: set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_ROLE_KEY in .env.test.local (a dedicated test project).";

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function serviceClient(): SupabaseClient {
  return createClient(url, serviceKey, options);
}

/** A signed-out client (what a visitor without a session would use). */
export function anonClient(): SupabaseClient {
  return createClient(url, anonKey, options);
}

export interface TestTenant {
  label: string;
  email: string;
  password: string;
  userId: string;
  businessId: string | null;
  /** Client signed in as this user: every request carries their session, so RLS applies. */
  client: SupabaseClient;
}

/**
 * Creates an auth user, optionally a business plus profile (what provision-owner.sql does), and a
 * client signed in as that user. Use withBusiness=false to test an account with no business.
 */
export async function createTenant(label: string, withBusiness = true): Promise<TestTenant> {
  const admin = serviceClient();
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${randomUUID()}`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
  const userId = created.data.user.id;

  let businessId: string | null = null;
  if (withBusiness) {
    const business = await admin.from("businesses").insert({ name: `${label} business` }).select("id").single();
    if (business.error) throw new Error(`business insert failed: ${business.error.message}`);
    businessId = business.data.id as string;
    const profile = await admin.from("profiles").insert({ user_id: userId, business_id: businessId });
    if (profile.error) throw new Error(`profile insert failed: ${profile.error.message}`);
  }

  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`sign-in failed: ${signedIn.error.message}`);

  return { label, email, password, userId, businessId, client };
}

/** Removes everything a tenant created. Safe to call more than once. */
export async function deleteTenant(tenant: TestTenant): Promise<void> {
  const admin = serviceClient();
  if (tenant.businessId) {
    // Orders reference stores and medicines, so they go first. The service role is the only role
    // allowed to delete order history rows (the app itself never uses it). Before migration 0003 is
    // applied these tables do not exist and the errors are ignored on purpose.
    await admin.from("order_events").delete().eq("business_id", tenant.businessId);
    await admin.from("order_lines").delete().eq("business_id", tenant.businessId);
    await admin.from("orders").delete().eq("business_id", tenant.businessId);
    await admin.from("order_counters").delete().eq("business_id", tenant.businessId);
    await admin.from("products").delete().eq("business_id", tenant.businessId);
    await admin.from("imports").delete().eq("business_id", tenant.businessId); // after products (they reference it)
    await admin.from("stores").delete().eq("business_id", tenant.businessId);
    await admin.from("profiles").delete().eq("user_id", tenant.userId);
    await admin.from("businesses").delete().eq("id", tenant.businessId);
  }
  await admin.auth.admin.deleteUser(tenant.userId);
}
