// The pure parts of the leftover sweep of the TEST project (Module 011, T050). No network call and no file read here, so every
// rule is unit-tested. The script that uses it is `scripts/sweep-test-project.mjs`. Type annotations only (no enums), so Node can
// run this file directly.

/** `KEY=value` lines of an env file, as an object. Quotes around a value are removed. Nothing is printed or logged. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    out[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** The project reference of a Supabase address (`https://<ref>.supabase.co`), or null when it is not one. */
export function projectRefOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = /^([a-z0-9]{10,})\.supabase\.(co|in|net)$/i.exec(host);
    return match ? match[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type TargetCheck = { ok: true; ref: string } | { ok: false; reason: string };

/**
 * Whether the sweep may run: it needs a real test project address and key, and the project must not be the one the app itself
 * uses (`NEXT_PUBLIC_SUPABASE_URL` of `.env.local`, the owner's development project).
 */
export function checkTarget(args: { testUrl?: string; serviceKey?: string; appUrl?: string }): TargetCheck {
  if (!args.testUrl || !args.serviceKey) return { ok: false, reason: "SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY must be set in .env.test.local." };
  const ref = projectRefOf(args.testUrl);
  if (!ref) return { ok: false, reason: "SUPABASE_TEST_URL is not a Supabase project address." };
  const appRef = projectRefOf(args.appUrl);
  if (appRef && appRef === ref) return { ok: false, reason: "SUPABASE_TEST_URL is the same project as NEXT_PUBLIC_SUPABASE_URL (the app's own project). The sweep only ever runs on a separate test project." };
  return { ok: true, ref };
}

/** Test users are made by `createTenant` with an address `<label>-<8 characters>@example.test`. */
export function isTestEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /^[a-z0-9-]+-[0-9a-f]{8}@example\.test$/i.test(email);
}

/** The label of a test business: its name without the ` business` that `createTenant` adds, for example `e2e-fresh`. */
export function labelOf(name: string): string | null {
  // Lower case letters, digits and hyphens only: the labels tests give. A name a person typed has capitals or spaces.
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*) business$/.exec(name);
  return match ? match[1]! : null;
}

export interface BusinessRow {
  id: string;
  name: string;
  created_at: string;
}

export interface Candidate {
  businessId: string;
  userIds: string[];
  label: string;
  ageMinutes: number;
}

/**
 * The businesses that may be swept: the name is `<label> business` (lower case, as tests write it), EVERY user linked to it has a
 * test address (or it has none left), and it is older than `minAgeMinutes` (so a test running right now is never touched). The
 * owner's own business can never match: its user has a real address.
 */
export function pickCandidates(args: {
  businesses: BusinessRow[];
  usersOfBusiness: Map<string, string[]>;
  emailOfUser: Map<string, string>;
  now: Date;
  minAgeMinutes: number;
}): Candidate[] {
  const out: Candidate[] = [];
  for (const business of args.businesses) {
    const label = labelOf(business.name);
    const userIds = args.usersOfBusiness.get(business.id) ?? [];
    if (!label) continue;
    // A business left with no user at all (the old clean-up deleted the user and then failed on the business) is a leftover too.
    if (!userIds.every((id) => isTestEmail(args.emailOfUser.get(id)))) continue;
    const ageMinutes = Math.floor((args.now.getTime() - new Date(business.created_at).getTime()) / 60_000);
    if (!Number.isFinite(ageMinutes) || ageMinutes < args.minAgeMinutes) continue;
    out.push({ businessId: business.id, userIds, label, ageMinutes });
  }
  return out;
}

/** How many businesses there are of each label, for the report (names and counts only). */
export function countByLabel(candidates: Candidate[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface SweepArgs {
  del: boolean;
  minAgeMinutes: number;
  limit: number | null;
}

/** `--delete`, `--min-age-minutes=30`, `--limit=20`. Anything else is refused. */
export function parseArgs(argv: string[]): SweepArgs | { error: string } {
  const args: SweepArgs = { del: false, minAgeMinutes: 30, limit: null };
  for (const arg of argv) {
    if (arg === "--delete") args.del = true;
    else if (/^--min-age-minutes=\d+$/.test(arg)) args.minAgeMinutes = Number(arg.split("=")[1]);
    else if (/^--limit=\d+$/.test(arg) && Number(arg.split("=")[1]) > 0) args.limit = Number(arg.split("=")[1]);
    else return { error: `Unknown option: ${arg}. Use --delete, --min-age-minutes=N or --limit=N.` };
  }
  return args;
}
