import type { ApiErrorBody, ErrorCode } from "./errors";

export const SESSION_EXPIRED_EVENT = "app:session-expired";

/** What a 401 does: "redirect" takes the person to sign-in (or shows the banner on a screen with typed text); "event" only tells the page (the sync centre uses it so a background send never navigates away). */
export type UnauthorizedMode = "redirect" | "event";

/** An answer from the device copy, used only for a fixed list of GET requests when the network failed (Module 009). */
export interface LocalAnswer {
  status: number;
  body: unknown;
}
export type LocalAnswerHook = (method: string, url: string) => Promise<LocalAnswer | null>;

/** Told about every real answer or network failure, so the app knows whether it is online (Module 009). */
export interface ConnectivityReporter {
  reportSuccess(): void;
  reportFailure(): void;
}

let localAnswerHook: LocalAnswerHook | null = null;
let connectivityReporter: ConnectivityReporter | null = null;

export function setLocalAnswerHook(hook: LocalAnswerHook | null): void {
  localAnswerHook = hook;
}

export function setConnectivityReporter(reporter: ConnectivityReporter | null): void {
  connectivityReporter = reporter;
}

/** A request that gets no answer in this time counts as a network failure instead of waiting forever. */
export const GET_TIMEOUT_MS = 15_000;
export const WRITE_TIMEOUT_MS = 20_000;

export class ClientApiError extends Error {
  readonly code: ErrorCode | "network";
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly matches?: unknown[];
  readonly current?: unknown;
  readonly current_lines?: unknown[];
  readonly current_price?: string;
  readonly blockers?: unknown[];

  constructor(code: ErrorCode | "network", status: number, message: string, body?: Partial<ApiErrorBody>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = body?.fields;
    this.matches = body?.matches;
    this.current = body?.current;
    this.current_lines = body?.current_lines;
    this.current_price = body?.current_price;
    this.blockers = body?.blockers;
  }
}

/** Where to send the user to sign in again, returning to the current screen afterwards. */
export function signInUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `/sign-in?next=${encodeURIComponent(here)}&reason=expired`;
}

function handleExpiredSession(mode: UnauthorizedMode) {
  // A form or screen with typed text marks itself with data-unsaved-guard. Keep it on screen and show the
  // banner (the user signs in in a new tab and retries). Anywhere else, go to sign-in directly. With mode "event"
  // (background sending) the person is never taken away from the screen: the banner is shown and sending pauses.
  const formOnScreen = mode === "event" || document.querySelector("[data-unsaved-guard]");
  if (formOnScreen) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } else {
    window.location.assign(signInUrl());
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  signal?: AbortSignal;
  onUnauthorized?: UnauthorizedMode;
}

export interface JsonAnswer<T> {
  status: number;
  data: T;
  /** "device" when the answer came from the copy kept on this phone because the network failed. */
  source?: "device";
}

/** The answer of the device copy for a failed GET, in the same shape as a real answer (or an error like a real one). */
async function fromDevice<T>(method: string, url: string): Promise<JsonAnswer<T> | null> {
  if (method !== "GET" || localAnswerHook === null) return null;
  let answer: LocalAnswer | null;
  try {
    answer = await localAnswerHook(method, url);
  } catch {
    return null;
  }
  if (answer === null) return null;
  if (answer.status >= 200 && answer.status < 300) return { status: answer.status, data: answer.body as T, source: "device" };
  const errorBody = (answer.body ?? {}) as Partial<ApiErrorBody>;
  throw new ClientApiError((errorBody.code as ErrorCode) ?? "server_error", answer.status, errorBody.message ?? "Something went wrong. Please try again.", errorBody);
}

/**
 * JSON request to this app's API. Never reports success unless the server confirmed it:
 * network failures, timeouts, 401 and every error status throw a ClientApiError. When the network fails, a fixed list of GET
 * requests may be answered from the copy kept on this phone (the answer says `source: "device"`).
 */
export async function fetchJson<T>(url: string, options: RequestOptions = {}): Promise<JsonAnswer<T>> {
  const method = options.method ?? (options.json !== undefined ? "POST" : "GET");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === "GET" ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const cleanup = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    cleanup();
    // The caller cancelled this request: not a network problem.
    if (options.signal?.aborted && error instanceof DOMException && error.name === "AbortError") throw error;
    connectivityReporter?.reportFailure();
    const local = await fromDevice<T>(method, url);
    if (local) return local;
    throw new ClientApiError("network", 0, "Can't reach the server. Check your connection and try again.");
  }

  let body: unknown = null;
  let cancelled = false;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (for example a gateway error page), or the body did not arrive in time.
    cancelled = controller.signal.aborted;
  } finally {
    cleanup();
  }
  if (cancelled) {
    // The answer started but never finished: the caller cancelled it, or it took too long (a network failure).
    if (options.signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
    connectivityReporter?.reportFailure();
    throw new ClientApiError("network", 0, "Can't reach the server. Check your connection and try again.");
  }

  // A gateway error means the app server itself was not reached; anything else was answered by it.
  if (response.status >= 502 && response.status <= 504) connectivityReporter?.reportFailure();
  else connectivityReporter?.reportSuccess();

  if (response.ok) return { status: response.status, data: body as T };

  const errorBody = (body ?? {}) as Partial<ApiErrorBody>;
  if (response.status === 401) {
    handleExpiredSession(options.onUnauthorized ?? "redirect");
    throw new ClientApiError("unauthenticated", 401, "Your session expired. Please sign in again.", errorBody);
  }
  throw new ClientApiError(
    (errorBody.code as ErrorCode) ?? "server_error",
    response.status,
    errorBody.message ?? "Something went wrong. Please try again.",
    errorBody,
  );
}
