import { describe, expect, it } from "vitest";
import { MemoryDeviceStorage } from "../helpers/memory-storage";
import { readAuthCookieValue, rememberIdentity, resolveIdentity, userIdFromCookie } from "@/lib/device/identity";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const BIZ_A = "123e4567-e89b-42d3-a456-426614174000";
const BIZ_B = "123e4567-e89b-42d3-a456-426614174001";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(sub: string): string {
  return `${b64url(JSON.stringify({ alg: "HS256" }))}.${b64url(JSON.stringify({ sub }))}.signature`;
}

function sessionJson(userId: string, withUser = true): string {
  return JSON.stringify({ access_token: jwt(userId), refresh_token: "r", ...(withUser ? { user: { id: userId } } : {}) });
}

const NAME = "sb-projectref-auth-token";

describe("device identity", () => {
  it("reads the user id from a plain JSON cookie", () => {
    const header = `other=1; ${NAME}=${encodeURIComponent(sessionJson(USER_A))}; theme=x`;
    expect(userIdFromCookie(header)).toEqual({ userId: USER_A, reason: null });
  });

  it("reads the user id from a cookie split into two chunks", () => {
    const value = encodeURIComponent(sessionJson(USER_A));
    const half = Math.floor(value.length / 2);
    const header = `${NAME}.1=${value.slice(half)}; ${NAME}.0=${value.slice(0, half)}`;
    expect(readAuthCookieValue(header)).toBe(sessionJson(USER_A));
    expect(userIdFromCookie(header).userId).toBe(USER_A);
  });

  it("reads the user id from a base64- prefixed value", () => {
    const header = `${NAME}=base64-${b64url(sessionJson(USER_B))}`;
    expect(userIdFromCookie(header).userId).toBe(USER_B);
  });

  it("falls back to the sub claim of the access token", () => {
    const header = `${NAME}=${encodeURIComponent(sessionJson(USER_A, false))}`;
    expect(userIdFromCookie(header).userId).toBe(USER_A);
  });

  it("reports a missing or unreadable cookie as needing sign-in", () => {
    expect(userIdFromCookie("")).toEqual({ userId: null, reason: "no_cookie" });
    expect(userIdFromCookie("a=1; b=2")).toEqual({ userId: null, reason: "no_cookie" });
    expect(userIdFromCookie(`${NAME}=not-json`).reason).toBe("bad_cookie");
    expect(userIdFromCookie(`${NAME}=base64-@@@`).reason).toBe("bad_cookie");
    expect(userIdFromCookie(`${NAME}=${encodeURIComponent(JSON.stringify({ access_token: "x.y.z" }))}`).reason).toBe("bad_cookie");
  });

  it("opens the business of the signed-in user from the registry", async () => {
    const storage = new MemoryDeviceStorage();
    await storage.putRegistryEntry({ userId: USER_A, businessId: BIZ_A, businessName: "Alpha", lastSignedInAt: "T" });
    const header = `${NAME}=${encodeURIComponent(sessionJson(USER_A))}`;
    expect(await resolveIdentity(storage, header)).toEqual({ status: "ok", userId: USER_A, businessId: BIZ_A, businessName: "Alpha" });
  });

  it("opens nothing for a user the registry does not know, and never another user's business", async () => {
    const storage = new MemoryDeviceStorage();
    await storage.putRegistryEntry({ userId: USER_A, businessId: BIZ_A, businessName: "Alpha", lastSignedInAt: "T" });
    const asB = `${NAME}=${encodeURIComponent(sessionJson(USER_B))}`;
    expect(await resolveIdentity(storage, asB)).toEqual({ status: "needs_sign_in", reason: "no_registry" });
    expect(await resolveIdentity(storage, "")).toEqual({ status: "needs_sign_in", reason: "no_cookie" });
  });

  it("gives each user their own business when both are known", async () => {
    const storage = new MemoryDeviceStorage();
    await storage.putRegistryEntry({ userId: USER_A, businessId: BIZ_A, businessName: "Alpha", lastSignedInAt: "T" });
    await storage.putRegistryEntry({ userId: USER_B, businessId: BIZ_B, businessName: "Beta", lastSignedInAt: "T" });
    const b = await resolveIdentity(storage, `${NAME}=${encodeURIComponent(sessionJson(USER_B))}`);
    expect(b.status === "ok" && b.businessId).toBe(BIZ_B);
  });

  it("remembers the identity the server verified and refuses a cookie of another user", async () => {
    const storage = new MemoryDeviceStorage();
    const header = `${NAME}=${encodeURIComponent(sessionJson(USER_A))}`;
    const ok = await rememberIdentity(storage, header, { userId: USER_A, businessId: BIZ_A, businessName: "Alpha" });
    expect(ok.status).toBe("ok");
    expect((await storage.getRegistryEntry(USER_A))?.businessId).toBe(BIZ_A);
    const mismatch = await rememberIdentity(storage, header, { userId: USER_B, businessId: BIZ_B, businessName: "Beta" });
    expect(mismatch).toEqual({ status: "needs_sign_in", reason: "mismatch" });
    expect(await storage.getRegistryEntry(USER_B)).toBeUndefined();
  });

  it("never returns or stores the cookie value", async () => {
    const storage = new MemoryDeviceStorage();
    const header = `${NAME}=${encodeURIComponent(sessionJson(USER_A))}`;
    await rememberIdentity(storage, header, { userId: USER_A, businessId: BIZ_A, businessName: "Alpha" });
    const stored = JSON.stringify(await storage.listRegistry());
    expect(stored).not.toContain("access_token");
    expect(stored).not.toContain("refresh_token");
    expect(stored).not.toContain("signature");
  });
});
