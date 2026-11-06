import { z } from "zod";
import { moneyUpdate, optionalMoney } from "./money";

const LIMITS = {
  name: 200,
  unit: 50,
  brand: 200,
  generic_name: 200,
  strength: 100,
  dosage_form: 100,
  manufacturer: 200,
  pack_size: 100,
  sku: 100,
} as const;

/** Optional text for create: a missing key, blank or null becomes null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((v) => (v == null || v === "" ? null : v))
    .default(null);

/** Optional text for update: missing key stays undefined (unchanged); blank or null clears it. */
const optionalTextUpdate = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const name = z
  .string("Enter the medicine name.")
  .trim()
  .min(1, "Enter the medicine name.")
  .max(LIMITS.name, `Name can be at most ${LIMITS.name} characters.`);

const unit = z
  .string("Choose or enter a unit.")
  .trim()
  .min(1, "Choose or enter a unit.")
  .max(LIMITS.unit, `Unit can be at most ${LIMITS.unit} characters.`);

export const ProductCreateSchema = z.object({
  id: z.uuid("A valid id is required."),
  name,
  unit,
  brand: optionalText(LIMITS.brand, "Brand"),
  generic_name: optionalText(LIMITS.generic_name, "Generic name"),
  strength: optionalText(LIMITS.strength, "Strength"),
  dosage_form: optionalText(LIMITS.dosage_form, "Dosage form"),
  manufacturer: optionalText(LIMITS.manufacturer, "Manufacturer"),
  pack_size: optionalText(LIMITS.pack_size, "Pack size"),
  sku: optionalText(LIMITS.sku, "SKU"),
  purchase_price: optionalMoney,
  selling_price: optionalMoney,
  mrp: optionalMoney,
  confirm_similar: z.boolean().optional().default(false),
});

export const ProductUpdateSchema = z.object({
  expected_version: z.number("expected_version is required.").int().min(1),
  name: name.optional(),
  unit: unit.optional(),
  brand: optionalTextUpdate(LIMITS.brand, "Brand"),
  generic_name: optionalTextUpdate(LIMITS.generic_name, "Generic name"),
  strength: optionalTextUpdate(LIMITS.strength, "Strength"),
  dosage_form: optionalTextUpdate(LIMITS.dosage_form, "Dosage form"),
  manufacturer: optionalTextUpdate(LIMITS.manufacturer, "Manufacturer"),
  pack_size: optionalTextUpdate(LIMITS.pack_size, "Pack size"),
  sku: optionalTextUpdate(LIMITS.sku, "SKU"),
  purchase_price: moneyUpdate,
  selling_price: moneyUpdate,
  mrp: moneyUpdate,
  is_active: z.boolean().optional(),
  confirm_similar: z.boolean().optional().default(false),
});

export type ProductCreateInput = z.infer<typeof ProductCreateSchema>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateSchema>;
