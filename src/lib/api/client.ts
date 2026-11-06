import type { ApiErrorBody, ErrorCode } from "./errors";

export const SESSION_EXPIRED_EVENT = "app:session-expired";

export class ClientApiError extends Error {
  readonly code: ErrorCode | "network";
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly matches?: unknown[];
  readonly current?: unknown;

  constructor(code: ErrorCode | "network", status: number, message: string, body?: Partial<ApiErrorBody>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = body?.fields;
    this.matches = body?.matches;
    this.current = body?.current;
  }
}

/** Where to send the user to sign in again, returning to the current screen afterwards. */
export function signInUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/sign-in?next=${encodeURIComponent(here)}&reason=expired`;
}

function handleExpiredSession() {
  // A form or screen with typed text marks itself with data-unsaved-guard. Keep it on screen and show the
  // banner (the user signs in in a new tab and retries). Anywhere else, go to sign-in directly.
  const formOnScreen = document.querySelector("[data-unsaved-guard]");
  if (formOnScreen) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } else {
    window.location.assign(signInUrl());
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  json?: unknown;
  signal?: AbortSignal;
}

/**
 * JSON request to this app's API. Never reports success unless the server confirmed it:
 * network failures, 401 and every error status throw a ClientApiError.
 */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<{ status: number; data: T }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.json !== undefined ? "POST" : "GET"),
      headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ClientApiError("network", 0, "Can't reach the server. Check your connection and try again.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (for example a gateway error page).
  }

  if (response.ok) return { status: response.status, data: body as T };

  const errorBody = (body ?? {}) as Partial<ApiErrorBody>;
  if (response.status === 401) {
    handleExpiredSession();
    throw new ClientApiError("unauthenticated", 401, "Your session expired. Please sign in again.", errorBody);
  }
  throw new ClientApiError(
    (errorBody.code as ErrorCode) ?? "server_error",
    response.status,
    errorBody.message ?? "Something went wrong. Please try again.",
    errorBody,
  );
}
