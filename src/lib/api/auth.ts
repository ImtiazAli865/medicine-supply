import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { noBusiness, unauthenticated } from "./errors";

export interface BusinessContext {
  user: User;
  supabase: SupabaseClient;
  businessId: string;
}

export type ContextResult =
  | { status: "ok"; context: BusinessContext }
  | { status: "signed_out" }
  | { status: "no_business"; user: User };

/**
 * Verifies the caller with the auth server (never trusting an unverified cookie) and loads their
 * business. Pages use the result to redirect; API routes use `requireBusinessUser` below.
 * All data access goes through the returned client, which carries the user's session, so Row Level
 * Security always applies.
 */
export async function loadBusinessContext(): Promise<ContextResult> {
  // Without configuration nothing can be authenticated; the sign-in page explains the problem.
  if (!isSupabaseConfigured()) return { status: "signed_out" };
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { status: "signed_out" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("business_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { status: "no_business", user };

  return { status: "ok", context: { user, supabase, businessId: profile.business_id as string } };
}

/** For server-rendered pages: redirects instead of throwing. Pages never rely on the layout alone. */
export async function requirePageContext(): Promise<BusinessContext> {
  const result = await loadBusinessContext();
  if (result.status === "signed_out") redirect("/sign-in");
  if (result.status === "no_business") redirect("/account-not-set-up");
  return result.context;
}

/** For route handlers: throws 401 `unauthenticated` or 403 `no_business`. */
export async function requireBusinessUser(): Promise<BusinessContext> {
  const result = await loadBusinessContext();
  if (result.status === "signed_out") throw unauthenticated();
  if (result.status === "no_business") throw noBusiness();
  return result.context;
}
