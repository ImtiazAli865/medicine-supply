import type { RowStatus } from "@/lib/import/types";

export const STATUS_LABEL: Record<RowStatus, string> = {
  new: "New",
  exists: "Already exists",
  similar: "Similar",
  file_duplicate: "Duplicate in file",
  sku_used: "SKU already used",
  invalid: "Invalid",
};

export const STATUS_TONE: Record<RowStatus, "neutral" | "warning" | "success" | "danger"> = {
  new: "success",
  exists: "neutral",
  similar: "warning",
  file_duplicate: "neutral",
  sku_used: "danger",
  invalid: "danger",
};

export const STATUS_ORDER: RowStatus[] = ["new", "similar", "exists", "file_duplicate", "sku_used", "invalid"];
