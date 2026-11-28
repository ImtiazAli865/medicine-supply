import { randomUUID } from "node:crypto";
import { waitDeviceReady } from "../helpers/offline";
import { expect, signIn, test } from "./fixtures";

// Cookies are shared by everything served from one host name, so a browser can hold the sign-in cookie of another Supabase
// project next to this app's own. The phone's storage must still start for the person signed in here.
test.describe("another project's sign-in cookie on the same address", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 400, "mobile project only");

  test("does not stop the phone storage and the offline features from starting", async ({ page, context, baseURL, freshTenant }) => {
    const other = JSON.stringify({ access_token: "x", user: { id: randomUUID() } });
    // Added before sign-in, so it comes first in the list of cookies.
    await context.addCookies([{ name: "sb-otherproject-auth-token", value: encodeURIComponent(other), url: baseURL! }]);
    await signIn(page, freshTenant);
    await waitDeviceReady(page);
    await expect(page.getByTestId("sync-indicator")).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByTestId("sync-status")).toBeVisible();
  });
});
