import { MAX_BODY_BYTES } from "@/lib/import/columns";
import { ApiError } from "./errors";

const tooLarge = () =>
  new ApiError("validation_error", "This file has too much text to send at once. Split it into two files and import them one by one.");

/**
 * Reads a JSON body but refuses anything over `maxBytes` (default 4 MB) with a clear validation error,
 * so one oversized request can never tie up the server.
 */
export async function readJsonBodyCapped(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("validation_error", "The request body must be valid JSON.");
  }
}
