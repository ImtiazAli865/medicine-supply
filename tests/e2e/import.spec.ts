import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  csv5000, damagedXlsx, HEADER_ROW, macroXlsx, passwordProtectedXlsx, tooLargeCsv, tooManyRowsCsv, tooWideCsv, validCsv, validXlsx, xlsx5000,
} from "../helpers/import-files";
import type { TestTenant } from "../helpers/supabase-test";
import { expect, signIn, test } from "./fixtures";

const fixture = (name: string) => readFileSync(path.resolve("tests/fixtures/import", name));
const MIME_CSV = "text/csv";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function choose(page: Page, name: string, buffer: Buffer | Uint8Array | string, mimeType = MIME_CSV) {
  await page.getByTestId("import-file").setInputFiles({ name, mimeType, buffer: Buffer.from(buffer as Buffer) });
}

async function productCount(t: TestTenant): Promise<number> {
  const { count } = await t.client.from("products").select("id", { count: "exact", head: true });
  return count ?? 0;
}

test.describe("US1: catalog import", () => {
  test.beforeEach(async ({ page, freshTenant }) => {
    await signIn(page, freshTenant, "/products/import");
    await expect(page.getByRole("heading", { name: "Import medicines", level: 1 })).toBeVisible();
  });

  test("downloads both templates with the exact headings", async ({ page }) => {
    const csv = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV template" }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toBe("medicine-import-template.csv");
    const text = readFileSync((await csvFile.path()) as string, "utf8");
    expect(text.replace(/^﻿/, "").split("\r\n")[0]).toBe(HEADER_ROW.join(","));
    expect(text).toContain("EXAMPLE - delete this row");

    const xlsx = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Excel template" }).click();
    expect((await xlsx).suggestedFilename()).toBe("medicine-import-template.xlsx");
    await expect(page.getByText(/Name and unit are required/)).toBeVisible();
  });

  test("a valid CSV previews 5 New rows, saves nothing until confirmed, then imports exactly the file", async ({ page, freshTenant }) => {
    await choose(page, "valid-5.csv", validCsv());
    await expect(page.getByTestId("preview-list")).toBeVisible();
    await expect(page.locator('[data-status="new"]')).toHaveCount(5);
    await expect(page.getByTestId("will-create")).toContainText("5 medicines will be created");
    expect(await productCount(freshTenant)).toBe(0);

    // leaving without confirming keeps the catalog unchanged
    await page.reload();
    expect(await productCount(freshTenant)).toBe(0);

    await choose(page, "valid-5.csv", validCsv());
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("import-summary")).toBeVisible();
    await expect(page.getByTestId("summary-created")).toHaveText("5");
    await expect(page.getByTestId("summary-skipped")).toHaveText("0");

    const { data } = await freshTenant.client.from("products").select("name,unit,purchase_price,selling_price,mrp,sku,is_active").order("name");
    expect(data).toHaveLength(5);
    const calpol = data!.find((p) => p.name === "Calpol")!;
    // PostgREST returns numeric columns as JSON numbers; 50.5 here is exactly the file's 50.50
    expect(calpol).toMatchObject({ unit: "bottle", purchase_price: 50.5, selling_price: 70, mrp: 80, sku: null, is_active: true });
    const cetrin = data!.find((p) => p.name === "Cetrin")!;
    expect(cetrin).toMatchObject({ purchase_price: null, selling_price: null, mrp: null }); // empty stays empty
    expect(data!.some((p) => p.name === "پیراسیٹامول")).toBe(true);

    // refreshing shows the same summary (it has its own address)
    await page.reload();
    await expect(page.getByTestId("summary-created")).toHaveText("5");
    // imported medicines without a selling price say so
    await page.goto("/products");
    await expect(page.getByText("No selling price").first()).toBeVisible();
  });

  test("an .xlsx file works the same and reports the sheet that was read", async ({ page, freshTenant }) => {
    await choose(page, "valid-5.xlsx", await validXlsx(), MIME_XLSX);
    await expect(page.getByText(/sheet "Medicines" was read/)).toBeVisible();
    await expect(page.locator('[data-status="new"]')).toHaveCount(5);
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("summary-created")).toHaveText("5");
    expect(await productCount(freshTenant)).toBe(5);
  });

  test("shows every status with reasons, lets similar rows be created, and imports exactly what the preview said", async ({ page, freshTenant }) => {
    const seeded = await freshTenant.client.from("products").insert({
      id: randomUUID(), name: "Panadol", unit: "strip", strength: "500 mg", dosage_form: "Tablet", pack_size: "10 tabs", manufacturer: "GSK",
    });
    expect(seeded.error).toBeNull();

    await choose(page, "all-problems.csv", fixture("all-problems.csv"));
    await expect(page.getByTestId("preview-list")).toBeVisible();
    const status = (n: number) => page.getByTestId(`preview-row-${n}`);
    await expect(status(2)).toHaveAttribute("data-status", "new");
    await expect(status(3)).toHaveAttribute("data-status", "exists");
    await expect(status(4)).toHaveAttribute("data-status", "similar");
    await expect(status(5)).toHaveAttribute("data-status", "new");
    await expect(status(6)).toHaveAttribute("data-status", "file_duplicate");
    await expect(status(7)).toHaveAttribute("data-status", "sku_used");
    for (const n of [8, 9, 10, 11]) await expect(status(n)).toHaveAttribute("data-status", "invalid");
    await expect(status(3)).toContainText('Already in your list as "Panadol"');
    await expect(status(8)).toContainText("Unit is required");
    await expect(status(9)).toContainText("cannot be negative");
    await expect(status(10)).toContainText("at most two decimals");
    await expect(status(11)).toContainText("at most 200 characters");

    // filters show only that status
    await page.getByTestId("filter-invalid").click();
    await expect(page.locator('[data-testid^="preview-row-"]')).toHaveCount(4);
    await page.getByTestId("filter-all").click();

    // similar is skipped by default; choosing it changes the final counts BEFORE confirming
    await expect(page.getByTestId("will-create")).toContainText("2 medicines will be created");
    await expect(page.getByTestId("will-skip")).toContainText("8 rows will be skipped");
    await page.getByTestId("create-similar-4").check();
    await expect(page.getByTestId("will-create")).toContainText("3 medicines will be created (1 as separate similar products)");
    await expect(page.getByTestId("will-skip")).toContainText("7 rows will be skipped");
    expect(await productCount(freshTenant)).toBe(1); // still only the seeded one

    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("summary-created")).toHaveText("3");
    await expect(page.getByTestId("summary-skipped")).toHaveText("7");
    await expect(page.getByTestId("skipped-list")).toContainText("Row 3");
    expect(await productCount(freshTenant)).toBe(4);
    // never created: exact duplicate, repeated SKU, in-file duplicate
    const { data } = await freshTenant.client.from("products").select("name,strength").in("name", ["Panadol", "Cetrizine", "Brufen"]);
    expect(data!.filter((p) => p.name === "Panadol")).toHaveLength(2);
    expect(data!.filter((p) => p.name === "Brufen")).toHaveLength(1);
    expect(data!.filter((p) => p.name === "Cetrizine")).toHaveLength(0);
  });

  test("double-pressing Confirm creates no duplicates", async ({ page, freshTenant }) => {
    await choose(page, "valid-5.csv", validCsv());
    const confirm = page.getByTestId("confirm-import");
    await expect(confirm).toBeVisible();
    await confirm.dblclick();
    await expect(page.getByTestId("import-summary")).toBeVisible();
    expect(await productCount(freshTenant)).toBe(5);
  });

  for (const bad of [
    { name: "bad-header.csv", build: () => fixture("bad-header.csv"), message: /not in the template: colour/ },
    { name: "missing-unit-column.csv", build: () => fixture("missing-unit-column.csv"), message: /Missing required column: unit/ },
    { name: "header-only.csv", build: () => fixture("header-only.csv"), message: /No medicines found/ },
    { name: "empty.csv", build: () => fixture("empty.csv"), message: /empty/ },
    { name: "not-a-sheet.pdf", build: () => fixture("not-a-sheet.pdf"), message: /not supported/ },
    { name: "semicolon.csv", build: () => fixture("semicolon.csv"), message: /semicolons or tabs/ },
    { name: "damaged.xlsx", build: () => damagedXlsx(), message: /damaged/, mime: MIME_XLSX },
    { name: "password-protected.xlsx", build: () => passwordProtectedXlsx(), message: /password-protected/, mime: MIME_XLSX },
    { name: "macro.xlsx", build: () => macroXlsx(), message: /macros/, mime: MIME_XLSX },
    { name: "too-large.csv", build: () => tooLargeCsv(), message: /limit is 5 MB/ },
    { name: "too-many-rows.csv", build: () => tooManyRowsCsv(), message: /more than 10,000 medicines/ },
    { name: "too-wide.csv", build: () => tooWideCsv(), message: /too much text to send at once/ },
  ] as { name: string; build: () => Buffer | Uint8Array | string | Promise<Uint8Array>; message: RegExp; mime?: string }[]) {
    test(`a bad file (${bad.name}) shows a clear message and changes nothing`, async ({ page, freshTenant }) => {
      await choose(page, bad.name, await bad.build(), bad.mime);
      await expect(page.getByTestId("file-error")).toContainText(bad.message);
      await expect(page.getByTestId("preview-list")).toHaveCount(0);
      await expect(page.getByTestId("confirm-import")).toHaveCount(0);
      expect(await productCount(freshTenant)).toBe(0);
    });
  }

  test("a heading error lists the headings found and expected", async ({ page }) => {
    await choose(page, "bad-header.csv", fixture("bad-header.csv"));
    await expect(page.getByTestId("file-error")).toContainText("Found: name, unit, colour");
    await expect(page.getByTestId("file-error")).toContainText("Expected: name, unit, brand, generic name");
  });

  test("a medicine added elsewhere after the preview makes Confirm import nothing and show a fresh preview", async ({ page, freshTenant }) => {
    await choose(page, "valid-5.csv", validCsv());
    await expect(page.locator('[data-status="new"]')).toHaveCount(5);
    const added = await freshTenant.client.from("products").insert({
      id: randomUUID(), name: "Amoxil", unit: "strip", strength: "500 mg", dosage_form: "Capsule", pack_size: "10 caps", manufacturer: "Sami",
    });
    expect(added.error).toBeNull();

    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("changed-notice")).toContainText("nothing was imported");
    expect(await productCount(freshTenant)).toBe(1); // only the one added elsewhere
    await expect(page.locator('[data-status="new"]')).toHaveCount(4);
    await expect(page.locator('[data-status="exists"]')).toHaveCount(1);
    await expect(page.getByTestId("will-create")).toContainText("4 medicines will be created");
  });

  test("refreshing while a confirm is still in flight shows the summary of that import", async ({ page, freshTenant }) => {
    await page.route("**/api/imports", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch(); // the server applies the import
      await new Promise((r) => setTimeout(r, 4000)); // but the browser does not hear back yet
      await route.fulfill({ response }).catch(() => {});
    });
    await choose(page, "valid-5.csv", validCsv());
    await page.getByTestId("confirm-import").click();
    await expect.poll(() => productCount(freshTenant), { timeout: 15_000 }).toBe(5);
    await page.reload();
    await expect(page.getByTestId("import-summary")).toBeVisible();
    await expect(page.getByTestId("summary-created")).toHaveText("5");
    expect(await productCount(freshTenant)).toBe(5);
  });

  test("history lists earlier imports and starts empty with a next action", async ({ page }) => {
    await expect(page.getByTestId("history-empty")).toContainText("Choose a file above");
    await choose(page, "valid-5.csv", validCsv());
    await page.getByTestId("confirm-import").click();
    await expect(page.getByTestId("import-summary")).toBeVisible();
    await page.getByRole("link", { name: "Import another file" }).click();
    await expect(page.getByTestId("history-list")).toContainText("valid-5.csv");
  });

  test("shows a loading state and an error with Retry for the history list", async ({ page }) => {
    let fail = true;
    await page.route("**/api/imports?**", (route) =>
      fail ? route.fulfill({ status: 500, json: { code: "server_error", message: "Something went wrong. Please try again." } }) : route.continue());
    await page.reload();
    await expect(page.getByTestId("error-state")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("history-empty")).toBeVisible();
  });

  for (const kind of ["csv", "xlsx"] as const) {
    test(`a 5,000-row ${kind} file previews within 30 s with progress, stays usable, and imports within 60 s`, async ({ page, freshTenant }) => {
      test.setTimeout(240_000);
      const body = kind === "csv" ? Buffer.from(csv5000()) : Buffer.from(await xlsx5000());

      const progress = page.waitForSelector('[data-testid="reading"], [data-testid="previewing"]', { state: "attached", timeout: 15_000 });
      const started = Date.now();
      await choose(page, `bulk.${kind}`, body, kind === "csv" ? MIME_CSV : MIME_XLSX);
      await progress; // a visible progress indicator while reading / checking
      await expect(page.getByTestId("preview-list")).toBeVisible({ timeout: 30_000 });
      const previewSeconds = (Date.now() - started) / 1000;
      console.log(`5,000-row ${kind}: preview after ${previewSeconds.toFixed(1)} s`);
      expect(previewSeconds).toBeLessThan(30);

      // windowed list: only the first page of rows is in the page, and filtering still works
      expect(await page.locator('[data-testid^="preview-row-"]').count()).toBeLessThanOrEqual(100);
      await page.getByTestId("filter-new").click();
      await expect(page.getByRole("button", { name: /Show more/ })).toBeVisible();
      await expect(page.getByTestId("will-create")).toContainText("5,000 medicines will be created");

      const importStarted = Date.now();
      await page.getByTestId("confirm-import").click();
      await expect(page.getByTestId("summary-created")).toHaveText("5,000", { timeout: 60_000 });
      const importSeconds = (Date.now() - importStarted) / 1000;
      console.log(`5,000-row ${kind}: import took ${importSeconds.toFixed(1)} s`);
      expect(importSeconds).toBeLessThan(60);
      expect(await productCount(freshTenant)).toBe(5000);
    });
  }
});
