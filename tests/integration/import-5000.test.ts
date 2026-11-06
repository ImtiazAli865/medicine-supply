import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyImport, previewImport } from "@/lib/imports/repository";
import type { RawRow } from "@/lib/import/types";
import { ApplyRequestSchema } from "@/lib/validation/import";
import { createTenant, deleteTenant, hasTestEnv, SKIP_REASON, type TestTenant } from "../helpers/supabase-test";

// SC-002 (server part): a 5,000-row list previews in <= 30 s and imports in <= 60 s on the real
// Supabase test project. The browser-side reading time is measured in the Playwright test.
const suite = hasTestEnv ? describe : describe.skip;
if (!hasTestEnv) console.warn(SKIP_REASON);

suite("5,000-row import against Supabase", () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await createTenant("import-5000");
  });
  afterAll(async () => {
    await deleteTenant(t);
  });

  it("previews within 30 s and imports within 60 s", async () => {
    const rows: RawRow[] = Array.from({ length: 5000 }, (_, i) => ({
      row_no: i + 2,
      name: `Bulk Medicine ${i}`,
      unit: "strip",
      strength: `${i} mg`,
      dosage_form: "Tablet",
      manufacturer: "Maker",
      pack_size: "10 tabs",
      purchase_price: "10.00",
      selling_price: "12.00",
      mrp: "15.00",
    }));

    const t0 = Date.now();
    const preview = await previewImport(t.client, rows);
    const previewMs = Date.now() - t0;
    expect(preview.counts.new).toBe(5000);
    expect(previewMs).toBeLessThan(30_000);

    const t1 = Date.now();
    const res = await applyImport(
      t.client,
      ApplyRequestSchema.parse({ import_id: randomUUID(), file_name: "bulk.csv", file_kind: "csv", rows, fingerprint: preview.fingerprint }),
    );
    const importMs = Date.now() - t1;
    expect(res.import.created_count).toBe(5000);
    expect(importMs).toBeLessThan(60_000);

    const { count } = await t.client.from("products").select("id", { count: "exact", head: true });
    expect(count).toBe(5000);
    console.log(`Supabase 5,000-row preview: ${previewMs} ms; import: ${importMs} ms`);
  }, 120_000);
});
