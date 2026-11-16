import { notFound } from "next/navigation";
import { InvoicePrintView } from "@/components/invoices/InvoicePrintView";
import { PrintLayoutToolbar } from "@/components/invoices/PrintLayoutToolbar";
import { requirePageContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { invoiceUrl } from "@/lib/invoices/client";
import { getInvoice } from "@/lib/invoices/repository";
import { parseLayout, parseSummaryChoice } from "@/lib/invoices/status";
import { getSettings } from "@/lib/settings/repository";

export const metadata = { title: "Print invoice · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({ params, searchParams }: PageProps<"/invoices/[id]/print">) {
  const { id } = await params;
  const raw = await searchParams;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const layout = parseLayout(raw.layout);

  let invoice;
  try {
    invoice = await getInvoice(supabase, id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") notFound();
    throw error;
  }

  // The paper width is a setting (80 mm by default). If settings cannot be read, 80 mm is used.
  const settings = await getSettings(supabase).catch(() => null);
  const width = settings?.thermal_paper_mm ?? 80;

  // The Account Summary: shown only for an issued invoice that has a saved snapshot. The box starts from the Settings
  // default (off unless the supplier turned it on) and the address carries the choice for this print only.
  const available = invoice.status === "issued" && invoice.in_account && invoice.account_summary !== null;
  const on = available && parseSummaryChoice(raw.summary, settings?.account_summary_default ?? false);
  const unavailableReason = available
    ? null
    : invoice.status === "draft"
      ? "A draft has no Account Summary yet."
      : invoice.status === "cancelled"
        ? "A cancelled invoice is printed without an Account Summary."
        : "No Account Summary was saved for this invoice (it was issued before store accounts were added).";

  return (
    <div className="space-y-4">
      <PrintLayoutToolbar invoiceId={id} layout={layout} backHref={invoiceUrl(id)} backLabel="Invoice" summary={{ available, on, unavailableReason }} />
      {layout === "thermal" ? <style>{`@page { size: ${width}mm auto; margin: 3mm; }`}</style> : null}
      <InvoicePrintView invoice={invoice} layout={layout} thermalWidthMm={width} showSummary={on} />
    </div>
  );
}
