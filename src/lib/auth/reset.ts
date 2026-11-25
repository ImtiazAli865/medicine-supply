// The pure rules of the password reset (Module 011, research D12, contracts/auth-reset.openapi.yaml). No network call is made
// here: the pages and the route pass in what the authentication service answered.

/** The shortest new password the form accepts (stricter than the project's own minimum of 6). */
export const MIN_PASSWORD = 8;

export const NEUTRAL_RESET_MESSAGE = "If this email has an account, a message was sent.";
export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const LINK_ERROR_MESSAGE = "This link has expired or was already used. Ask for a new one.";

export const FORGOT_PATH = "/forgot-password";
export const FORGOT_LINK_ERROR_PATH = "/forgot-password?error=link";
export const RESET_PATH = "/reset-password";

export interface AuthErrorLike {
  status?: number;
  name?: string;
  code?: string;
}

/**
 * The one message shown after asking for the reset email. It is the same whether the address has an account or not, and also
 * when the service limited the request, so the answer never tells who has an account. Only a request that could not leave the
 * phone says so, because then nothing was asked.
 */
export function resetRequestMessage(error: AuthErrorLike | null): string {
  if (error === null) return NEUTRAL_RESET_MESSAGE;
  const couldNotReach = error.name === "AuthRetryableFetchError" || error.status === 0 || error.status === undefined;
  return couldNotReach ? NETWORK_MESSAGE : NEUTRAL_RESET_MESSAGE;
}

export type PasswordCheck = { ok: true } | { ok: false; field: "password" | "confirm"; message: string };

/** The new password, typed twice. The old password is never asked for. Length is counted in characters. */
export function validateNewPassword(password: string, confirm: string): PasswordCheck {
  if (password === "") return { ok: false, field: "password", message: "Enter a new password." };
  if ([...password].length < MIN_PASSWORD) return { ok: false, field: "password", message: `Use at least ${MIN_PASSWORD} characters.` };
  if (confirm === "") return { ok: false, field: "confirm", message: "Type the new password again." };
  if (confirm !== password) return { ok: false, field: "confirm", message: "The two passwords do not match." };
  return { ok: true };
}

// Letters, digits, underscore, hyphen and dot: what a token hash is made of. No slash, no colon, no space.
const TOKEN_HASH = /^[A-Za-z0-9_.-]{8,512}$/;

/** The token hash when the link is a well-formed recovery link, otherwise null. Any `next` parameter is never read. */
export function cleanConfirmParams(params: { tokenHash: string | null | undefined; type: string | null | undefined }): string | null {
  if (params.type !== "recovery") return null;
  if (typeof params.tokenHash !== "string" || !TOKEN_HASH.test(params.tokenHash)) return null;
  return params.tokenHash;
}

export type ConfirmTarget = typeof RESET_PATH | typeof FORGOT_LINK_ERROR_PATH;

/**
 * Where the browser goes after the emailed link was opened: the reset page when the service verified the link, the forgot page
 * with a plain error for everything else (malformed, used, expired, wrong type, service unreachable). It returns one of two fixed
 * addresses, never anything taken from the request, and a malformed link is never sent to the service.
 */
export async function confirmRedirect(
  params: { tokenHash: string | null | undefined; type: string | null | undefined },
  verify: (tokenHash: string) => Promise<boolean>,
): Promise<ConfirmTarget> {
  const hash = cleanConfirmParams(params);
  if (hash === null) return FORGOT_LINK_ERROR_PATH;
  try {
    return (await verify(hash)) ? RESET_PATH : FORGOT_LINK_ERROR_PATH;
  } catch {
    return FORGOT_LINK_ERROR_PATH;
  }
}
