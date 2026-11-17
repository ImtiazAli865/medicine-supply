import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { Order } from "../../src/lib/orders/types";
import type { Candidate, DiagnosticPage, DiagnosticKind, ParserKind } from "../../src/lib/voice/types";
import { catalogLine, typedLine, type LineInput } from "./orders";
import { insertMedicine, insertStore } from "./pending-db";
import { withRole } from "./pglite";

// ---------------------------------------------------------------------------------------------------
// Calling the Module 008 functions on PGlite as a signed-in user (what PostgREST does for a request).
// ---------------------------------------------------------------------------------------------------

export interface VoiceSaveResult {
  saved?: boolean;
  replayed?: boolean;
  created?: boolean;
  reason?: string;
  order?: Order & { spoken_text?: string | null };
  detail?: { message?: string };
}

export interface VoiceSaveOptions {
  requestId?: string;
  expectedVersion?: number | null;
  notes?: string | null;
  source?: string;
  spokenText?: string | null;
}

/** `order_save` in its eight-argument form (the two trailing arguments are the voice ones). */
export async function dbVoiceSave(
  db: PGlite,
  userId: string,
  orderId: string,
  storeId: string,
  lines: LineInput[],
  options: VoiceSaveOptions = {},
): Promise<VoiceSaveResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: VoiceSaveResult }>(`select public.order_save($1, $2, $3, $4, $5, $6::jsonb, $7, $8) as r`, [
      orderId,
      options.requestId ?? randomUUID(),
      options.expectedVersion ?? null,
      storeId,
      options.notes ?? null,
      JSON.stringify(lines),
      options.source ?? "voice",
      options.spokenText === undefined ? "Panadol 20 strips" : options.spokenText,
    ]);
    return res.rows[0].r;
  });
}

/** `order_save` in the old six-argument form (the defaults make it a manual order). */
export async function dbManualSaveOldForm(db: PGlite, userId: string, orderId: string, storeId: string, lines: LineInput[]): Promise<VoiceSaveResult> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: VoiceSaveResult }>(`select public.order_save($1, $2, $3, $4, $5, $6::jsonb) as r`, [
      orderId,
      randomUUID(),
      null,
      storeId,
      null,
      JSON.stringify(lines),
    ]);
    return res.rows[0].r;
  });
}

export interface MatchRow extends Candidate {
  idx: number;
  score: number;
}

export async function dbMatchProducts(db: PGlite, userId: string, names: string[]): Promise<MatchRow[]> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: MatchRow[] | null }>(`select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) as r from public.voice_match_products($1::jsonb) m`, [
      JSON.stringify(names),
    ]);
    return (res.rows[0].r ?? []) as MatchRow[];
  });
}

export async function dbMatchStores(db: PGlite, userId: string, name: string): Promise<MatchRow[]> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: MatchRow[] | null }>(`select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) as r from public.voice_match_stores($1) m`, [name]);
    return (res.rows[0].r ?? []) as MatchRow[];
  });
}

export interface DiagArgs {
  kind: DiagnosticKind | string;
  parser?: ParserKind | string;
  items?: number;
  doubtful?: number;
  unreadable?: number;
  length?: number;
  message?: string | null;
}

export async function dbDiagAdd(db: PGlite, userId: string, a: DiagArgs): Promise<{ done?: boolean; skipped?: boolean; reason?: string }> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: { done?: boolean; skipped?: boolean; reason?: string } }>(
      `select public.voice_diag_add($1, $2, $3, $4, $5, $6, $7) as r`,
      [a.kind, a.parser ?? "ai", a.items ?? 0, a.doubtful ?? 0, a.unreadable ?? 0, a.length ?? 0, a.message ?? null],
    );
    return res.rows[0].r;
  });
}

export async function dbDiagList(db: PGlite, userId: string, limit = 20, offset = 0): Promise<DiagnosticPage> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: DiagnosticPage }>(`select public.voice_diag_list($1, $2) as r`, [limit, offset]);
    return res.rows[0].r;
  });
}

export async function dbParseAllow(db: PGlite, userId: string): Promise<{ allowed: boolean; retry_after_seconds?: number }> {
  return withRole(db, "authenticated", userId, async () => {
    const res = await db.query<{ r: { allowed: boolean; retry_after_seconds?: number } }>(`select public.voice_parse_allow() as r`);
    return res.rows[0].r;
  });
}

/** All diagnostic rows of a business, read as the table owner (tests only). */
export async function rawDiagnostics(db: PGlite, businessId: string): Promise<Array<{ kind: string; transcript_length: number; message: string | null }>> {
  const res = await db.query<{ kind: string; transcript_length: number; message: string | null }>(
    `select kind, transcript_length, message from public.voice_diagnostics where business_id = $1 order by created_at`,
    [businessId],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------------------------------
// A catalog built for matching tests: exact names, several strengths and forms of one brand, a pack size and a
// manufacturer difference, an inactive medicine and a few stores.
// ---------------------------------------------------------------------------------------------------

export interface VoiceCatalog {
  stores: { madina: string; shifa: string; madinaStore: string };
  products: {
    panadol500: string;
    panadol650: string;
    panadolExtra: string;
    brufen400: string;
    brufen200: string;
    calpol: string;
    augmentinGsk: string;
    augmentinOther: string;
    inactive: string;
  };
}

export async function seedVoiceCatalog(db: PGlite, businessId: string): Promise<VoiceCatalog> {
  const stores = {
    madina: await insertStore(db, businessId, "Al Madina Medical"),
    shifa: await insertStore(db, businessId, "Al Shifa Pharmacy"),
    madinaStore: await insertStore(db, businessId, "Madina Medical Store"),
  };
  const products = {
    panadol500: await insertMedicine(db, businessId, { name: "Panadol", brand: "Panadol", strength: "500 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", unit: "strip" }),
    panadol650: await insertMedicine(db, businessId, { name: "Panadol", brand: "Panadol", strength: "650 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "GSK", unit: "strip" }),
    panadolExtra: await insertMedicine(db, businessId, { name: "Panadol Extra", brand: "Panadol Extra", strength: "500 mg", dosage_form: "tablet", pack_size: "12", manufacturer: "GSK", unit: "strip" }),
    brufen400: await insertMedicine(db, businessId, { name: "Brufen", brand: "Brufen", strength: "400 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Abbott", unit: "box" }),
    brufen200: await insertMedicine(db, businessId, { name: "Brufen", brand: "Brufen", strength: "200 mg", dosage_form: "tablet", pack_size: "10", manufacturer: "Abbott", unit: "box" }),
    calpol: await insertMedicine(db, businessId, { name: "Calpol Syrup", brand: "Calpol", strength: "120 mg/5 ml", dosage_form: "syrup", pack_size: "60 ml", manufacturer: "GSK", unit: "bottle" }),
    augmentinGsk: await insertMedicine(db, businessId, { name: "Augmentin 625", brand: "Augmentin", strength: "625 mg", dosage_form: "tablet", pack_size: "14", manufacturer: "GSK", unit: "box" }),
    augmentinOther: await insertMedicine(db, businessId, { name: "Augmentin 625", brand: "Augmentin", strength: "625 mg", dosage_form: "tablet", pack_size: "14", manufacturer: "Other Pharma", unit: "box" }),
    inactive: await insertMedicine(db, businessId, { name: "Disprin", brand: "Disprin", strength: "300 mg", dosage_form: "tablet", unit: "strip", is_active: false }),
  };
  return { stores, products };
}

export { catalogLine, typedLine };
