import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError } from "./errors";

/** Cursors are opaque to clients; internally they are the offset of the next row. */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isInteger(offset) || offset < 0 || String(offset) !== cursor) {
    throw new ApiError("validation_error", "Invalid cursor.", { fields: { cursor: "Invalid cursor." } });
  }
  return offset;
}

/** Takes `limit + 1` fetched rows and returns the page plus the cursor of the next page. */
export function slicePage<T>(rows: T[], offset: number, limit: number): { items: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, next_cursor: hasMore ? String(offset + limit) : null };
}

/** True when a Postgres error is a unique violation (23505) on the named constraint or index. */
export function isUniqueViolation(error: PostgrestError | null, constraint: string): boolean {
  return Boolean(error && error.code === "23505" && `${error.message} ${error.details ?? ""}`.includes(constraint));
}

export function isAnyUniqueViolation(error: PostgrestError | null): boolean {
  return Boolean(error && error.code === "23505");
}
