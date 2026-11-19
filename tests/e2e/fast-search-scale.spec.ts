import { seedCatalog } from "../helpers/fast";
import { seedStore, startOrder } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// SC-003 of Module 008: with 5,000 medicines results show within 300 ms of a keystroke for at least 95% of keystrokes.
// The time is measured inside the page from the keystroke to the next painted frame, after the list is loaded.
test.describe("US3: search speed with 5,000 medicines", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("typing is answered at once, even while the list loads, and each keystroke shows results within 300 ms", async ({ page, freshTenant }) => {
    test.setTimeout(240_000);
    await seedCatalog(freshTenant.client, 5000);
    await seedStore(freshTenant, "Scale Store");
    await signIn(page, freshTenant);

    await startOrder(page, "Scale Store");
    const screenOpened = Date.now();
    // Typing during the load is answered by the server search.
    await page.getByTestId("fast-search").fill("medicine 00042");
    await expect(page.getByTestId("medicine-result").first()).toContainText("Medicine 00042");
    const firstResults = (Date.now() - screenOpened) / 1000;
    // The whole list is loaded on the device.
    await expect(page.getByTestId("refresh-medicines")).toBeVisible({ timeout: 60_000 });
    const loadSeconds = (Date.now() - screenOpened) / 1000;
    console.log(
      `fast-search-scale: 5,000 medicines, from the open order screen: first results (server search) after ${firstResults.toFixed(1)} s, complete list on the device after ${loadSeconds.toFixed(1)} s`,
    );

    const queries: string[] = [];
    for (const n of [42, 1234, 4999, 3000]) {
      const text = `medicine ${String(n).padStart(5, "0")}`;
      for (let i = 1; i <= text.length; i += 1) queries.push(text.slice(0, i));
    }

    const times: number[] = [];
    for (const query of queries) {
      const elapsed = await page.evaluate(async (text) => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="fast-search"]')!;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        const start = performance.now();
        setValue.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const first = document.querySelector('[data-testid="medicine-result"]');
        if (!first) return -1;
        return performance.now() - start;
      }, query);
      expect(elapsed, `results for "${query}"`).toBeGreaterThanOrEqual(0);
      times.push(elapsed);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    console.log(`fast-search-scale: ${times.length} keystrokes, median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted[sorted.length - 1]!.toFixed(1)} ms`);
    expect(p95).toBeLessThanOrEqual(300);

    // the last query finds exactly its medicine
    await expect(page.getByTestId("medicine-result").first()).toContainText("Medicine 03000");
  });
});
