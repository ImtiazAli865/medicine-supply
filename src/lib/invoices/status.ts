import type { BlockerReason, InvoiceStatus } from "./types";

// Labels and small helpers shared by the invoice screens, the print pages and the tests.

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  cancelled: "Cancelled",
};

/** The most a delivered quantity can be (the same cap as an order line). */
export const MAX_DELIVERED_QUANTITY = 100000;

/** `INV-000012`: the invoice number with a fixed prefix and at least six digits. Null for a draft. */
export function numberLabel(invoiceNumber: number | null | undefined): string | null {
  if (invoiceNumber === null || invoiceNumber === undefined) return null;
  return `INV-${String(invoiceNumber).padStart(6, "0")}`;
}

export type PrintLayout = "a4" | "thermal";

export const PRINT_LAYOUT_LABEL: Record<PrintLayout, string> = {
  a4: "A4",
  thermal: "Thermal",
};

/** Reads the `layout` query value; anything unknown means A4. */
export function parseLayout(value: string | string[] | undefined | null): PrintLayout {
  const text = Array.isArray(value) ? value[0] : value;
  return text === "thermal" ? "thermal" : "a4";
}

/**
 * Reads the `summary` query value of the print page: "1" shows the Account Summary, "0" hides it, and anything else (the
 * value is absent) means the Settings default decides.
 */
export function parseSummaryChoice(value: string | string[] | undefined | null, settingsDefault: boolean): boolean {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === "1") return true;
  if (text === "0") return false;
  return settingsDefault;
}

/** Why a billed line blocks issuing, in the words the supplier sees. */
export function blockerText(reason: BlockerReason): string {
  return reason === "typed"
    ? "Not registered yet. Register this medicine and give it a selling price."
    : "Needs a verified selling price.";
}

/**
 * Display text for an invoice amount such as "PKR 1,250.50". Invoice amounts can have up to 16 whole digits (a line
 * total is a quantity times a price), more than the 10 that a single price allows, so this groups the digits of the
 * text itself and does no arithmetic. A missing amount is a dash, never 0.
 */
export function formatInvoiceMoney(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const match = /^(\d{1,16})\.(\d{2})$/.exec(amount);
  if (!match) return "—";
  return `PKR ${match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${match[2]}`;
}

/** The label shown for a draft, an issued or a cancelled invoice in lists and headings. */
export function invoiceHeading(status: InvoiceStatus, label: string | null): string {
  if (status === "draft") return "Draft invoice";
  return label ?? "Invoice";
}
