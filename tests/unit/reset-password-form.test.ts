import { describe, expect, it, vi } from "vitest";
import {
  cleanConfirmParams,
  confirmRedirect,
  LINK_ERROR_MESSAGE,
  MIN_PASSWORD,
  NETWORK_MESSAGE,
  NEUTRAL_RESET_MESSAGE,
  resetRequestMessage,
  validateNewPassword,
} from "@/lib/auth/reset";

// Password reset (Module 011, research D12): the same neutral answer every time, a link accepted only as a recovery link with a
// well-formed token, and a new password of at least 8 characters that is typed twice.

describe("asking for the reset email", () => {
  it("gives the same neutral message when the email exists, does not exist, or the request is limited", () => {
    expect(NEUTRAL_RESET_MESSAGE).toBe("If this email has an account, a message was sent.");
    expect(resetRequestMessage(null)).toBe(NEUTRAL_RESET_MESSAGE); // sent
    expect(resetRequestMessage({ status: 400, name: "AuthApiError" })).toBe(NEUTRAL_RESET_MESSAGE); // unknown address or refused
    expect(resetRequestMessage({ status: 422, name: "AuthApiError" })).toBe(NEUTRAL_RESET_MESSAGE);
    expect(resetRequestMessage({ status: 429, name: "AuthApiError", code: "over_email_send_rate_limit" })).toBe(NEUTRAL_RESET_MESSAGE); // limited
  });

  it("says the connection is the problem only when the request could not leave the phone", () => {
    expect(NETWORK_MESSAGE).toBe("Can't reach the server. Check your connection and try again.");
    expect(resetRequestMessage({ status: 0, name: "AuthRetryableFetchError" })).toBe(NETWORK_MESSAGE);
    expect(resetRequestMessage({ name: "AuthRetryableFetchError" })).toBe(NETWORK_MESSAGE);
    expect(resetRequestMessage({})).toBe(NETWORK_MESSAGE);
  });
});

describe("the new password", () => {
  it("needs at least 8 characters, typed twice the same, and is never compared with an old password", () => {
    expect(MIN_PASSWORD).toBe(8);
    expect(validateNewPassword("", "")).toEqual({ ok: false, field: "password", message: "Enter a new password." });
    expect(validateNewPassword("short7!", "short7!")).toEqual({ ok: false, field: "password", message: "Use at least 8 characters." });
    expect(validateNewPassword("longenough", "")).toEqual({ ok: false, field: "confirm", message: "Type the new password again." });
    expect(validateNewPassword("longenough", "longenougH")).toEqual({ ok: false, field: "confirm", message: "The two passwords do not match." });
    expect(validateNewPassword("12345678", "12345678")).toEqual({ ok: true });
    expect(validateNewPassword("a password with spaces", "a password with spaces")).toEqual({ ok: true });
  });

  it("counts characters, not bytes: eight letters of another script are enough", () => {
    expect(validateNewPassword("کلمہ۔۔۔۔۔", "کلمہ۔۔۔۔۔")).toEqual({ ok: true });
  });
});

describe("the emailed link", () => {
  const hash = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

  it("accepts only type recovery and a token hash of 8 to 512 safe characters", () => {
    expect(cleanConfirmParams({ tokenHash: hash, type: "recovery" })).toBe(hash);
    expect(cleanConfirmParams({ tokenHash: "pkce_abc-DEF_123.45", type: "recovery" })).toBe("pkce_abc-DEF_123.45");
    for (const type of ["signup", "magiclink", "invite", "email_change", "RECOVERY", "", null, undefined, "recovery "]) {
      expect(cleanConfirmParams({ tokenHash: hash, type: type as string | null }), String(type)).toBeNull();
    }
    for (const bad of [null, undefined, "", "short", "x".repeat(7), "x".repeat(513), "has space in it", "semi;colon;here", "a<script>b", "../../etc/passwd", "ok\nnewline1"]) {
      expect(cleanConfirmParams({ tokenHash: bad as string | null, type: "recovery" }), String(bad)).toBeNull();
    }
    expect(cleanConfirmParams({ tokenHash: "x".repeat(8), type: "recovery" })).toBe("x".repeat(8));
    expect(cleanConfirmParams({ tokenHash: "x".repeat(512), type: "recovery" })).toBe("x".repeat(512));
  });

  it("goes to the reset page only after the service verified the link, and verifies exactly the cleaned hash", async () => {
    const verify = vi.fn(async () => true);
    expect(await confirmRedirect({ tokenHash: hash, type: "recovery" }, verify)).toBe("/reset-password");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(hash);
  });

  it("goes to the forgot page with a plain error, and no detail, for a link that is used, expired, wrong or malformed", async () => {
    const refused = vi.fn(async () => false);
    expect(await confirmRedirect({ tokenHash: hash, type: "recovery" }, refused)).toBe("/forgot-password?error=link");
    const never = vi.fn(async () => true);
    for (const params of [
      { tokenHash: null, type: "recovery" },
      { tokenHash: hash, type: null },
      { tokenHash: hash, type: "signup" },
      { tokenHash: "bad hash", type: "recovery" },
    ]) {
      expect(await confirmRedirect(params, never)).toBe("/forgot-password?error=link");
    }
    expect(never).not.toHaveBeenCalled(); // nothing malformed ever reaches the service
  });

  it("goes to the forgot page when the service cannot be reached or throws", async () => {
    const boom = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await confirmRedirect({ tokenHash: hash, type: "recovery" }, boom)).toBe("/forgot-password?error=link");
  });

  it("only ever returns one of two fixed addresses, whatever it was given (no open redirect, no echo)", async () => {
    const results = new Set<string>();
    for (const tokenHash of [hash, "https://evil.test/", "//evil.test", "javascript:alert(1)", null]) {
      for (const verified of [true, false]) results.add(await confirmRedirect({ tokenHash, type: "recovery" }, async () => verified));
    }
    expect([...results].sort()).toEqual(["/forgot-password?error=link", "/reset-password"]);
  });

  it("has the plain sentence for a link that does not work", () => {
    expect(LINK_ERROR_MESSAGE).toBe("This link has expired or was already used. Ask for a new one.");
  });
});
