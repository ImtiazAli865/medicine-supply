import { ZodError } from "zod";

export type ErrorCode =
  | "unauthenticated"
  | "no_business"
  | "not_found"
  | "validation_error"
  | "duplicate_product"
  | "similar_products"
  | "similar_store"
  | "sku_conflict"
  | "version_conflict"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  no_business: 403,
  not_found: 404,
  validation_error: 400,
  duplicate_product: 409,
  similar_products: 409,
  similar_store: 409,
  sku_conflict: 409,
  version_conflict: 409,
  server_error: 500,
};

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  matches?: unknown[];
  current?: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly matches?: unknown[];
  readonly current?: unknown;

  constructor(code: ErrorCode, message: string, extra: Partial<Pick<ApiErrorBody, "fields" | "matches" | "current">> = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = extra.fields;
    this.matches = extra.matches;
    this.current = extra.current;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { code: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.matches) body.matches = this.matches;
    if (this.current !== undefined) body.current = this.current;
    return body;
  }
}

export const unauthenticated = () => new ApiError("unauthenticated", "Your session expired. Please sign in again.");
export const noBusiness = () => new ApiError("no_business", "This account is not set up yet. Please contact the owner.");
export const notFound = () => new ApiError("not_found", "Not found.");
export const unusableId = () =>
  new ApiError("validation_error", "This id cannot be used.", { fields: { id: "This id cannot be used." } });

/** Converts a Zod error to a field-message map keyed by the first path segment. */
export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/** Runs a handler and turns every thrown error into the documented JSON error shape. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(error.toBody(), { status: error.status });
    }
    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        code: "validation_error",
        message: "Please correct the highlighted fields.",
        fields: zodFields(error),
      };
      return Response.json(body, { status: 400 });
    }
    // Never leak internals; log the real error on the server only.
    console.error("Unhandled API error:", error instanceof Error ? error.message : "unknown");
    return Response.json({ code: "server_error", message: "Something went wrong. Please try again." }, { status: 500 });
  }
}

/** Reads and parses a JSON body, turning malformed JSON into a validation error. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("validation_error", "The request body must be valid JSON.");
  }
}
