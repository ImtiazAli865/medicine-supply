import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { getSettings, saveSettings } from "@/lib/settings/repository";
import { SettingsUpdateSchema } from "@/lib/validation/settings";
import { anonClient, createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// The code behind /api/settings against a real Supabase test project (real user, RLS in effect).
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

const input = (version: number, extra: Record<string, unknown> = {}) =>
  SettingsUpdateSchema.parse({ expected_version: version, name: "Acme Pharma", phone: "0300-1234567", address: "Lahore", thermal_paper_mm: 58, account_summary_default: true, ...extra });
const errorOf = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError | null;

suite("settings API against Supabase", () => {
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    a = await createTenant("settings-a");
    b = await createTenant("settings-b");
  });
  afterAll(async () => {
    await deleteTenant(a);
    await deleteTenant(b);
  });

  it("returns defaults for a new business", async () => {
    expect(await getSettings(a.client)).toEqual({
      name: "settings-a business",
      phone: null,
      address: null,
      thermal_paper_mm: 80,
      account_summary_default: false,
      details_saved: false,
      checklist_dismissed: false,
      version: 1,
    });
  });

  it("saves, shows the saved values on the next read, marks details saved, and bumps the version", async () => {
    const saved = await saveSettings(a.client, input(1));
    expect(saved).toMatchObject({ name: "Acme Pharma", phone: "0300-1234567", address: "Lahore", thermal_paper_mm: 58, account_summary_default: true, details_saved: true, version: 2 });
    expect(await getSettings(a.client)).toEqual(saved);
    // the business name shown on screens comes from the same record
    const { data } = await a.client.from("businesses").select("name").maybeSingle();
    expect(data?.name).toBe("Acme Pharma");
  });

  it("clears phone and address when they are saved empty", async () => {
    const saved = await saveSettings(a.client, input(2, { phone: "", address: "  " }));
    expect(saved.phone).toBeNull();
    expect(saved.address).toBeNull();
    expect(saved.version).toBe(3);
  });

  it("refuses a stale version with the current settings, and does not overwrite", async () => {
    const error = await errorOf(saveSettings(a.client, input(1, { name: "Stale" })));
    expect(error?.code).toBe("version_conflict");
    expect(error?.status).toBe(409);
    expect((error?.current as { name: string; version: number }).name).toBe("Acme Pharma");
    expect((await getSettings(a.client)).name).toBe("Acme Pharma");
  });

  it("refuses values the database check forbids (defence behind the request validation)", async () => {
    const { error } = await a.client.rpc("save_business_settings", {
      p_expected_version: 3, p_name: "Acme Pharma", p_phone: null, p_address: null, p_thermal_paper_mm: 39, p_account_summary_default: false,
    });
    expect(error?.code).toBe("23514");
    const { error: nameError } = await a.client.rpc("save_business_settings", {
      p_expected_version: 3, p_name: "   ", p_phone: null, p_address: null, p_thermal_paper_mm: 80, p_account_summary_default: false,
    });
    expect(nameError?.code).toBe("23514");
    expect((await getSettings(a.client)).version).toBe(3);
  });

  it("the request schema refuses bad values with field messages", () => {
    for (const bad of [{ thermal_paper_mm: 39 }, { thermal_paper_mm: 121 }, { thermal_paper_mm: 80.5 }, { thermal_paper_mm: "abc" }, { name: " " }]) {
      expect(() => input(3, bad)).toThrow();
    }
  });

  it("one business never changes another's settings", async () => {
    expect(await getSettings(b.client)).toMatchObject({ name: "settings-b business", version: 1, details_saved: false });
  });

  it("a signed-out visitor cannot call the settings function or read settings", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("save_business_settings", {
      p_expected_version: 1, p_name: "x", p_phone: null, p_address: null, p_thermal_paper_mm: 80, p_account_summary_default: false,
    });
    expect(error?.code).toBe("42501");
    const read = await anon.from("business_settings").select("*");
    expect(read.error?.code).toBe("42501");
  });
});
