// Who is signed in on this device while the network is away (Module 009, plan D4).
//
// Offline, no server can vouch for the user. The only thing used is the Supabase auth cookie of this browser, and only to
// choose WHICH device database to open: the user id is read from it (never trusted for anything else), the registry maps
// that user to a business, and the business has its own database. Every request that reaches the server is still checked
// by the real session and row level security, so a forged cookie gains nothing.
//
// The cookie is never logged, stored or returned: only the user id leaves this file.

import type { DeviceStorage } from "./schema";

export type NeedsSignInReason = "no_cookie" | "bad_cookie" | "no_registry" | "mismatch";

export type Identity =
  | { status: "ok"; userId: string; businessId: string; businessName: string }
  | { status: "needs_sign_in"; reason: NeedsSignInReason };

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.(\d+))?$/;

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function base64UrlToText(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The name of this app's sign-in cookie, as Supabase builds it from the project's address; null when no address is
 * configured. Cookies are shared by everything served from one host name, so another project's cookie must not be read.
 */
function ownCookieName(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/** Joins the chunks of the auth cookie (`.0`, `.1`, ...) from a `document.cookie` style string; null when there is none. */
export function readAuthCookieValue(cookieHeader: string): string | null {
  const own = ownCookieName();
  const groups = new Map<string, Array<{ index: number; value: string }>>();
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const match = AUTH_COOKIE.exec(name);
    if (!match) continue;
    const base = name.replace(/\.\d+$/, "");
    if (own !== null && base !== own) continue;
    const list = groups.get(base) ?? [];
    list.push({ index: match[1] === undefined ? 0 : Number(match[1]), value: safeDecodeURIComponent(part.slice(eq + 1).trim()) });
    groups.set(base, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.index - b.index);
    return list.map((c) => c.value).join("");
  }
  return null;
}

/** Turns the joined cookie value (JSON, or `base64-` followed by base64url JSON) into the stored session object. */
export function parseSessionValue(raw: string): unknown | null {
  const text = raw.startsWith("base64-") ? base64UrlToText(raw.slice("base64-".length)) : raw;
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function subOfJwt(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  const text = base64UrlToText(payload);
  if (text === null) return null;
  try {
    const sub = (JSON.parse(text) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub !== "" ? sub : null;
  } catch {
    return null;
  }
}

/** The user id of the signed-in user according to the auth cookie, or null. Reads nothing else. */
export function userIdFromCookie(cookieHeader: string): { userId: string | null; reason: "no_cookie" | "bad_cookie" | null } {
  const raw = readAuthCookieValue(cookieHeader);
  if (raw === null || raw === "") return { userId: null, reason: "no_cookie" };
  const session = parseSessionValue(raw);
  if (session === null || typeof session !== "object") return { userId: null, reason: "bad_cookie" };
  const record = session as { user?: { id?: unknown }; access_token?: unknown };
  const fromUser = record.user && typeof record.user.id === "string" && record.user.id !== "" ? record.user.id : null;
  const userId = fromUser ?? subOfJwt(record.access_token);
  return userId === null ? { userId: null, reason: "bad_cookie" } : { userId, reason: null };
}

/**
 * Offline: which business's database may be opened. No cookie, a cookie that cannot be read, or a user the registry does
 * not know gives `needs_sign_in` and nothing is opened. Another user's registry entry can never be reached.
 */
export async function resolveIdentity(storage: DeviceStorage, cookieHeader: string): Promise<Identity> {
  const { userId, reason } = userIdFromCookie(cookieHeader);
  if (userId === null) return { status: "needs_sign_in", reason: reason ?? "bad_cookie" };
  const entry = await storage.getRegistryEntry(userId);
  if (!entry) return { status: "needs_sign_in", reason: "no_registry" };
  return { status: "ok", userId, businessId: entry.businessId, businessName: entry.businessName };
}

export interface ServerIdentity {
  userId: string;
  businessId: string;
  businessName: string;
}

/**
 * Online: the server (which verified the session) says who is signed in. When the cookie names a different user the app
 * refuses to open any database (`mismatch`); otherwise the registry entry is written so the offline shell can find the
 * business later.
 */
export async function rememberIdentity(storage: DeviceStorage, cookieHeader: string, server: ServerIdentity): Promise<Identity> {
  const { userId: cookieUser } = userIdFromCookie(cookieHeader);
  if (cookieUser !== null && cookieUser !== server.userId) return { status: "needs_sign_in", reason: "mismatch" };
  await storage.putRegistryEntry({
    userId: server.userId,
    businessId: server.businessId,
    businessName: server.businessName,
    lastSignedInAt: new Date().toISOString(),
  });
  return { status: "ok", userId: server.userId, businessId: server.businessId, businessName: server.businessName };
}
