import { z } from "zod";

const LIMITS = { name: 200, phone: 50, address: 500 } as const;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((v) => (v == null || v === "" ? null : v))
    .default(null);

export const PAPER_MIN = 40;
export const PAPER_MAX = 120;

export const SettingsUpdateSchema = z.object({
  expected_version: z.number("expected_version is required.").int().min(1),
  name: z
    .string("Enter the business name.")
    .trim()
    .min(1, "Enter the business name.")
    .max(LIMITS.name, `Business name can be at most ${LIMITS.name} characters.`),
  phone: optionalText(LIMITS.phone, "Phone"),
  address: optionalText(LIMITS.address, "Address"),
  thermal_paper_mm: z
    .number(`Enter the paper width as a whole number of millimetres (${PAPER_MIN} to ${PAPER_MAX}).`)
    .int("Use a whole number of millimetres, without decimals.")
    .min(PAPER_MIN, `The paper width must be at least ${PAPER_MIN} mm.`)
    .max(PAPER_MAX, `The paper width can be at most ${PAPER_MAX} mm.`),
  account_summary_default: z.boolean("Choose on or off."),
});

export const ChecklistDismissSchema = z.object({
  dismissed: z.boolean("dismissed must be true or false."),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
