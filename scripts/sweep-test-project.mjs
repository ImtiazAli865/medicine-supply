// Removes the leftover test businesses of the TEST Supabase project (Module 011, T050 and T053).
//
//   npm run test:sweep                      a DRY RUN: lists what would be removed, removes nothing
//   npm run test:sweep -- --delete          removes them (only after the owner said yes)
//   npm run test:sweep -- --min-age-minutes=60 --limit=20
//
// Safety: it reads the address and the service key of the TEST project from .env.test.local, refuses to run when that is the
// project of the app itself (.env.local), touches only businesses named "<label> business" whose every user has a test address
// (<label>-<8 characters>@example.test), and never touches a business younger than 30 minutes. It prints only counts and names:
// never a key, a password or an email address. Needs Node 24 (it runs the TypeScript helpers directly).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cleanBusiness, forgetDiscoveredTables } from "../tests/helpers/tenant-cleanup.ts";
import { checkTarget, countByLabel, parseArgs, parseEnv, pickCandidates } from "./sweep-lib.ts";

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const readEnv = (name) => (existsSync(path.join(root, name)) ? parseEnv(readFileSync(path.join(root, name), "utf8")) : {});

  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }

  const testEnv = readEnv(".env.test.local");
  const appEnv = readEnv(".env.local");
  const target = checkTarget({ testUrl: testEnv.SUPABASE_TEST_URL, serviceKey: testEnv.SUPABASE_TEST_SERVICE_ROLE_KEY, appUrl: appEnv.NEXT_PUBLIC_SUPABASE_URL });
  if (!target.ok) {
    console.error(`Refused: ${target.reason}`);
    process.exitCode = 2;
    return;
  }

  const client = createClient(testEnv.SUPABASE_TEST_URL, testEnv.SUPABASE_TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`Test project ${target.ref} (${args.del ? "DELETE" : "dry run: nothing is removed"}).`);

  // All businesses, their users and the users' addresses (read only here).
  const businesses = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("businesses").select("id,name,created_at").order("created_at").range(from, from + 999);
    if (error) throw new Error(`Could not list the businesses: ${error.message}`);
    businesses.push(...data);
    if (data.length < 1000) break;
  }
  const usersOfBusiness = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("profiles").select("user_id,business_id").range(from, from + 999);
    if (error) throw new Error(`Could not list the profiles: ${error.message}`);
    for (const row of data) usersOfBusiness.set(row.business_id, [...(usersOfBusiness.get(row.business_id) ?? []), row.user_id]);
    if (data.length < 1000) break;
  }
  const emailOfUser = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list the users: ${error.message}`);
    for (const user of data.users) emailOfUser.set(user.id, user.email ?? "");
    if (data.users.length < 1000) break;
  }

  let candidates = pickCandidates({ businesses, usersOfBusiness, emailOfUser, now: new Date(), minAgeMinutes: args.minAgeMinutes });
  const kept = businesses.length - candidates.length;
  console.log(`${businesses.length} businesses on the project; ${candidates.length} are test businesses older than ${args.minAgeMinutes} minutes; ${kept} are left alone.`);
  for (const { label, count } of countByLabel(candidates)) console.log(`  ${String(count).padStart(5)}  ${label}`);
  if (args.limit !== null) candidates = candidates.slice(0, args.limit);

  if (!args.del) {
    console.log(`Dry run: nothing was removed. Run with --delete to remove ${candidates.length} test ${candidates.length === 1 ? "business" : "businesses"}.`);
    return;
  }

  forgetDiscoveredTables();
  let removed = 0;
  const failed = [];
  for (const candidate of candidates) {
    try {
      for (const userId of candidate.userIds.slice(1)) await client.auth.admin.deleteUser(userId); // a business has one test user; extra users first
      await cleanBusiness(client, { businessId: candidate.businessId, userId: candidate.userIds[0] ?? null });
      removed += 1;
    } catch (error) {
      failed.push(`${candidate.label}: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}`);
    }
  }
  console.log(`Removed ${removed} of ${candidates.length}.`);
  if (failed.length > 0) {
    console.error(`${failed.length} could not be removed:`);
    for (const line of failed.slice(0, 20)) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}

await main();
