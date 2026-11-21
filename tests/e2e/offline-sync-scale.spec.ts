import { randomUUID } from "node:crypto";
import { countOrders, goOffline, goOnline, linesOnServer, ordersOnServer, waitDeviceReady } from "../helpers/offline";
import { serviceClient } from "../helpers/supabase-test";
import { seedStore } from "./orders-helpers";
import { expect, signIn, test } from "./fixtures";

// SC-006 of Module 009: twenty orders of ten lines made on the phone are all sent by themselves within 60 seconds of the connection
// returning, in the order they were made, and the screen stays usable meanwhile (mobile, 360 px). Making twenty ten-line orders by
// tapping would take far longer than the test is about, so the waiting orders are written into the phone's own journal in the same
// shape the app writes them, while the phone is offline; sending them is the real queue.
test.describe("US2: twenty waiting orders", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");
  test.setTimeout(240_000);

  test("all twenty arrive within 60 seconds of the connection returning, once each, in the order they were made", async ({ page, context, freshTenant }) => {
    const storeId = await seedStore(freshTenant, "Scale Store");
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await goOffline(context);

    const ids: string[] = Array.from({ length: 20 }, () => randomUUID());
    await page.evaluate(
      async ({ ids, storeId }) => {
        const dbs = (await indexedDB.databases?.()) ?? [];
        const name = dbs.find((d) => d.name?.startsWith("medsupply-") && d.name !== "medsupply-registry")!.name!;
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["drafts", "meta"], "readwrite");
          ids.forEach((orderId, i) => {
            tx.objectStore("drafts").put({
              orderId,
              rev: 1,
              seq: i + 1,
              state: {
                storeId,
                notes: "",
                lines: Array.from({ length: 10 }, (_, j) => ({ id: crypto.randomUUID(), product_id: null, name: `Scale ${i + 1}-${j + 1}`, quantity: j + 1, unit: "strip" })),
              },
              lineInfo: {},
              baseVersion: null,
              inflight: null,
              serverOrder: null,
              syncState: "on_device",
              reason: null,
              conflict: null,
              tries: 0,
              nextTryTick: 0,
              neverSent: true,
              updatedOnDevice: "t",
            });
          });
          tx.objectStore("meta").put({ key: "journalSeq", value: ids.length });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { ids, storeId },
    );
    await page.reload(); // the app starts again and finds twenty waiting orders in its journal
    await expect(page.getByTestId("sync-indicator")).toContainText("20 waiting");
    expect(await countOrders(freshTenant)).toBe(0);

    const started = Date.now();
    await goOnline(context);
    await expect.poll(() => countOrders(freshTenant), { timeout: 60_000, intervals: [500, 1_000] }).toBe(20);
    const seconds = (Date.now() - started) / 1000;
    console.log("SYNC-20-ORDERS-SECONDS", seconds.toFixed(1));
    expect(seconds).toBeLessThanOrEqual(60);

    // once each, with their exact lines, in the order they were made (the server numbers orders as they arrive)
    const orders = await ordersOnServer(freshTenant);
    expect(new Set(orders.map((o) => o.id)).size).toBe(20);
    expect(orders.map((o) => o.id)).toEqual(ids);
    const { data: numbered } = await serviceClient().from("orders").select("id,order_number").eq("business_id", freshTenant.businessId!).order("order_number", { ascending: true });
    expect(numbered!.map((o) => o.id)).toEqual(ids);
    const sample = await linesOnServer(ids[7]!);
    expect(sample.map((l) => [l.name, l.quantity])).toEqual(Array.from({ length: 10 }, (_, j) => [`Scale 8-${j + 1}`, j + 1]));

    // the screens stayed usable and now say everything is sent
    await expect(page.getByTestId("sync-indicator")).toContainText("Online", { timeout: 30_000 });
    await page.goto("/orders/new");
    await page.getByTestId("store-option").filter({ hasText: "Scale Store" }).first().click();
    await expect(page.getByTestId("fast-search")).toBeVisible();
  });
});
