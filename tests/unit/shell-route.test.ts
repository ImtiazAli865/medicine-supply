import { describe, expect, it } from "vitest";
import { parseGo, shellHref } from "@/lib/device/shell-route";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const STORE = "223e4567-e89b-42d3-a456-426614174000";

describe("offline shell routes", () => {
  it("knows the three order screens and Settings", () => {
    expect(parseGo("/orders")).toEqual({ kind: "orders" });
    expect(parseGo("/orders/")).toEqual({ kind: "orders" });
    expect(parseGo("/orders/new")).toEqual({ kind: "new_order" });
    expect(parseGo("/settings")).toEqual({ kind: "settings" });
    expect(parseGo("/orders?status=draft")).toEqual({ kind: "orders" });
  });

  it("reads an order id and its store from the address", () => {
    expect(parseGo(`/orders/${ID}?store=${STORE}`)).toEqual({ kind: "order", id: ID, store: STORE });
    expect(parseGo(`/orders/${ID}`)).toEqual({ kind: "order", id: ID, store: null });
    expect(parseGo(`/orders/${ID}?store=not-a-uuid`)).toEqual({ kind: "order", id: ID, store: null });
  });

  it("blocks a malformed order id and the pages that need the internet, naming the area", () => {
    expect(parseGo("/orders/123")).toEqual({ kind: "blocked", area: "This order" });
    expect(parseGo(`/orders/${ID}/print`)).toEqual({ kind: "blocked", area: "Order sheets and printing" });
    expect(parseGo("/invoices")).toEqual({ kind: "blocked", area: "Invoices" });
    expect(parseGo("/invoices/abc/print")).toEqual({ kind: "blocked", area: "Invoices" });
    expect(parseGo("/accounts/xyz")).toEqual({ kind: "blocked", area: "Store accounts" });
    expect(parseGo("/products/import")).toEqual({ kind: "blocked", area: "Products" });
    expect(parseGo("/market-list/print")).toEqual({ kind: "blocked", area: "The market list" });
    expect(parseGo("/something-else")).toEqual({ kind: "blocked", area: "This page" });
  });

  it("shows the hub for no address and for anything that is not a plain path", () => {
    expect(parseGo(null)).toEqual({ kind: "home" });
    expect(parseGo("")).toEqual({ kind: "home" });
    expect(parseGo("/")).toEqual({ kind: "home" });
    for (const bad of ["https://evil.test/orders", "//evil.test/orders", "orders", "javascript:alert(1)", "/orders\\evil", "/orders/\u0000", "http://x/orders/new"]) {
      expect(parseGo(bad)).toEqual({ kind: "home" });
    }
  });

  it("builds shell addresses that parse back to the same screen", () => {
    for (const route of [{ kind: "orders" }, { kind: "new_order" }, { kind: "settings" }, { kind: "order", id: ID, store: STORE }, { kind: "order", id: ID, store: null }] as const) {
      const href = shellHref(route);
      const go = new URL(href, "http://x").searchParams.get("go");
      expect(parseGo(go)).toEqual(route);
    }
    expect(shellHref({ kind: "home" })).toBe("/offline");
  });
});
