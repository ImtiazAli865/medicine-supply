import { z } from "zod";
import { DEVICE_RATE_PAGE } from "@/lib/rates/types";

// Store rates (Module 012). The database checks the amount again.

const AMOUNT = "Enter a price above 0 with at most two decimals.";

export const RateSetSchema = z.object({
  rate: z
    .string(AMOUNT)
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, AMOUNT)
    .refine((v) => Number(v) > 0, AMOUNT),
  expected_version: z.number("expected_version is required (use null for a new rate).").int().min(1).nullable(),
});

export const RateRemoveQuerySchema = z.object({
  expected_version: z.coerce.number("expected_version is required.").int().min(1),
});

export const RatesPageQuerySchema = z.object({
  limit: z.coerce.number("Limit must be a whole number.").int().min(1).max(DEVICE_RATE_PAGE, `Limit can be at most ${DEVICE_RATE_PAGE}.`).optional(),
  cursor: z.string().max(12, "Invalid cursor.").optional(),
});
