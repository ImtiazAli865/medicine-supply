import { z } from "zod";
import { MAX_ROWS } from "@/lib/import/columns";
import { IMPORT_FIELDS } from "@/lib/import/types";

// Request schemas for the import API (see contracts/api.openapi.yaml). Cells are text exactly as read
// from the file; field validation (lengths, prices) is done by validateRow on the server, which
// turns bad cells into "invalid" rows instead of rejecting the whole request.

const cell = z.string().max(10_000).nullish();

const row = z
  .object({
    row_no: z.number().int().min(2).max(2_000_000),
    ...Object.fromEntries(IMPORT_FIELDS.map((f) => [f, cell])),
  })
  .strict();

const rows = z
  .array(row)
  .min(1, "There are no rows to import.")
  .max(MAX_ROWS, `At most ${MAX_ROWS.toLocaleString("en-US")} rows can be imported at once.`)
  .superRefine((list, ctx) => {
    const seen = new Set<number>();
    for (const r of list) {
      if (seen.has(r.row_no)) {
        ctx.addIssue({ code: "custom", message: `Row number ${r.row_no} appears more than once.` });
        return;
      }
      seen.add(r.row_no);
    }
  });

export const PreviewRequestSchema = z.object({ rows });

export const ApplyRequestSchema = z.object({
  import_id: z.uuid("A valid import id is required."),
  file_name: z.string().trim().min(1, "A file name is required.").max(255, "The file name is too long."),
  file_kind: z.enum(["csv", "xlsx"]),
  rows,
  fingerprint: z.string().min(1).max(100),
  create_similar: z.array(z.number().int().min(2)).max(MAX_ROWS).optional().default([]),
});

export const ImportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;
