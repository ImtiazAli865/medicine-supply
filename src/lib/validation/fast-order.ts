import { z } from "zod";

// Query validation for the three read routes of Module 008 (specs/008-fast-order-entry/contracts).

export const MEDICINES_PAGE_MAX = 900;
export const MEDICINES_SEARCH_MAX = 30;

const uuid = z.uuid("A valid id is required.");

export const MedicinesQuerySchema = z
  .object({
    q: z.string().max(200, "Search text can be at most 200 characters.").optional(),
    limit: z.coerce
      .number("Limit must be a whole number.")
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(MEDICINES_PAGE_MAX, `Limit can be at most ${MEDICINES_PAGE_MAX}.`)
      .optional(),
    cursor: z.string().max(12, "Invalid cursor.").optional(),
  })
  .transform((value, ctx) => {
    const q = (value.q ?? "").replace(/\s+/g, " ").trim();
    const searching = q !== "";
    const limit = value.limit ?? (searching ? MEDICINES_SEARCH_MAX : MEDICINES_PAGE_MAX);
    if (searching && limit > MEDICINES_SEARCH_MAX) {
      ctx.addIssue({ code: "custom", path: ["limit"], message: `With a search the limit can be at most ${MEDICINES_SEARCH_MAX}.` });
      return z.NEVER;
    }
    return { q: searching ? q : null, limit, cursor: value.cursor };
  });

export type MedicinesQuery = z.infer<typeof MedicinesQuerySchema>;

export const UsualQuerySchema = z.object({ store_id: uuid });
export type UsualQuery = z.infer<typeof UsualQuerySchema>;

export const RepeatQuerySchema = z.object({ store_id: uuid, order_id: uuid });
export type RepeatQuery = z.infer<typeof RepeatQuerySchema>;
