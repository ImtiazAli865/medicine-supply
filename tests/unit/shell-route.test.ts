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
    expect(parseGo("/reports")).toEqual({ kind: "blocked", area: "Reports" });
    expect(parseGo("/reports/sales?from=2026-11-01&to=2026-11-25")).toEqual({ kind: "blocked", area: "Reports" });
    expect(parseGo("/reports/balances")).toEqual({ kind: "blocked", area: "Reports" });
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

  it("knows the Record payment screen and keeps every other account address blocked (Module 011)", () => {
    expect(parseGo("/accounts/pay")).toEqual({ kind: "payment" });
    expect(parseGo("/accounts/pay/")).toEqual({ kind: "payment" });
    expect(parseGo("/accounts/pay?store=abc")).toEqual({ kind: "payment" });
    for (const path of ["/accounts", "/accounts/", `/accounts/${ID}`, "/accounts/xyz", `/accounts/${ID}/statement`, `/accounts/${ID}/payments`, "/accounts/payment", "/accounts/pay-now", "/accounts/pay/extra"]) {
      expect(parseGo(path), path).toEqual({ kind: "blocked", area: "Store accounts" });
    }
  });

  it("does not treat a crafted address as the Record payment screen", () => {
    for (const bad of ["//evil.test/accounts/pay", "/accounts/pay\\x", "https://evil.test/accounts/pay", "accounts/pay", "/accounts/pay\u0000", "/accounts/pay/../x", "/accounts/%70ay/../../x"]) {
      expect(parseGo(bad), bad).not.toEqual({ kind: "payment" });
    }
    // the address is normalised first, so a path that climbs out of /accounts/pay is the page it really points to
    expect(parseGo("/accounts/pay/../x")).toEqual({ kind: "blocked", area: "Store accounts" });
    expect(parseGo("/accounts/%70ay/../../x")).toEqual({ kind: "blocked", area: "This page" });
  });

  it("builds shell addresses that parse back to the same screen", () => {
    expect(shellHref({ kind: "payment" })).toBe("/offline?go=%2Faccounts%2Fpay");
    for (const route of [{ kind: "orders" }, { kind: "new_order" }, { kind: "settings" }, { kind: "payment" }, { kind: "order", id: ID, store: STORE }, { kind: "order", id: ID, store: null }] as const) {
      const href = shellHref(route);
      const go = new URL(href, "http://x").searchParams.get("go");
      expect(parseGo(go)).toEqual(route);
    }
    expect(shellHref({ kind: "home" })).toBe("/offline");
  });
});
