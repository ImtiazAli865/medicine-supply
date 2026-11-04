/** Mirrors the SQL function public.norm_text: lowercase, trimmed, collapsed whitespace, null -> "". */
export function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Escapes LIKE/ILIKE wildcards so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Splits search text into at most `max` lowercase tokens (all must match). */
export function searchTokens(query: string | null | undefined, max = 8): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, max);
}

/** Trims text and converts empty text to null (used for optional fields). */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
