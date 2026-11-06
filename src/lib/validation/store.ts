import { z } from "zod";

const LIMITS = { name: 200, contact_person: 200, phone: 50, address: 500, notes: 1000 } as const;

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
  .string("Enter the store name.")
  .trim()
  .min(1, "Enter the store name.")
  .max(LIMITS.name, `Name can be at most ${LIMITS.name} characters.`);

export const StoreCreateSchema = z.object({
  id: z.uuid("A valid id is required."),
  name,
  contact_person: optionalText(LIMITS.contact_person, "Contact person"),
  phone: optionalText(LIMITS.phone, "Phone"),
  address: optionalText(LIMITS.address, "Address"),
  notes: optionalText(LIMITS.notes, "Notes"),
  confirm_duplicate: z.boolean().optional().default(false),
});

export const StoreUpdateSchema = z.object({
  expected_version: z.number("expected_version is required.").int().min(1),
  name: name.optional(),
  contact_person: optionalTextUpdate(LIMITS.contact_person, "Contact person"),
  phone: optionalTextUpdate(LIMITS.phone, "Phone"),
  address: optionalTextUpdate(LIMITS.address, "Address"),
  notes: optionalTextUpdate(LIMITS.notes, "Notes"),
  is_active: z.boolean().optional(),
  confirm_duplicate: z.boolean().optional().default(false),
});

export type StoreCreateInput = z.infer<typeof StoreCreateSchema>;
export type StoreUpdateInput = z.infer<typeof StoreUpdateSchema>;

export const ListQuerySchema = z.object({
  q: z.string().max(200).optional().default(""),
  status: z.enum(["active", "inactive", "all"]).optional().default("active"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().max(20).optional(),
});

export type ListQuery = z.infer<typeof ListQuerySchema>;
