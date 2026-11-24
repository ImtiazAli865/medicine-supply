// Which screen the offline shell shows for the address the service worker redirected from (Module 009, plan D3).
// `go` is the path the person was going to (`/orders/new`, `/orders/<id>?store=<id>`, ...). It is read as a path only: an
// absolute address, a protocol-relative address or anything with a backslash is refused, and it is never used as a link
// target without being parsed here first.

import { isUuid } from "@/lib/ids";

export type ShellRoute =
  | { kind: "home" }
  | { kind: "orders" }
  | { kind: "new_order" }
  | { kind: "order"; id: string; store: string | null }
  | { kind: "settings" }
  | { kind: "blocked"; area: string };

const BLOCKED_AREAS: Array<[string, string]> = [
  ["/products", "Products"],
  ["/stores", "Stores"],
  ["/invoices", "Invoices"],
  ["/accounts", "Store accounts"],
  ["/market-list", "The market list"],
  ["/pending", "Pending items"],
  ["/reports", "Reports"],
];

export function parseGo(go: string | null | undefined): ShellRoute {
  if (go === null || go === undefined || go === "") return { kind: "home" };
  if (!go.startsWith("/") || go.startsWith("//") || go.includes("\\") || /[\u0000-\u001f]/.test(go)) return { kind: "home" };

  let url: URL;
  try {
    url = new URL(go, "http://shell.local");
  } catch {
    return { kind: "home" };
  }
  if (url.origin !== "http://shell.local") return { kind: "home" };

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { kind: "home" };
  if (path === "/orders") return { kind: "orders" };
  if (path === "/orders/new") return { kind: "new_order" };
  if (path === "/settings") return { kind: "settings" };

  const order = /^\/orders\/([^/]+)$/.exec(path);
  if (order) {
    const id = order[1]!;
    if (!isUuid(id)) return { kind: "blocked", area: "This order" };
    const store = url.searchParams.get("store");
    return { kind: "order", id: id.toLowerCase(), store: store !== null && isUuid(store) ? store.toLowerCase() : null };
  }
  if (path.startsWith("/orders/")) return { kind: "blocked", area: "Order sheets and printing" };

  for (const [prefix, area] of BLOCKED_AREAS) if (path === prefix || path.startsWith(`${prefix}/`)) return { kind: "blocked", area };
  return { kind: "blocked", area: "This page" };
}

/** The address of a screen inside the shell. Only the three order screens and Settings exist offline. */
export function shellHref(route: Exclude<ShellRoute, { kind: "blocked" }>): string {
  switch (route.kind) {
    case "home":
      return "/offline";
    case "orders":
      return "/offline?go=%2Forders";
    case "new_order":
      return "/offline?go=%2Forders%2Fnew";
    case "settings":
      return "/offline?go=%2Fsettings";
    case "order": {
      const inner = route.store ? `/orders/${route.id}?store=${route.store}` : `/orders/${route.id}`;
      return `/offline?go=${encodeURIComponent(inner)}`;
    }
  }
}
