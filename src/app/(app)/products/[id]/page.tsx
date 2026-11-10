import { ChevronLeft, Lock, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WaitingLinesButton } from "@/components/pending/WaitingLinesButton";
import { ActiveToggle } from "@/components/ui/ActiveToggle";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { formatPKR } from "@/lib/money";
import { getProduct } from "@/lib/products/repository";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd dir="auto">{value || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

export default async function ProductDetailPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const p = await getProduct(supabase, id);
  if (!p) notFound();

  return (
    <div className="space-y-4">
      <Link href="/products" className="inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft size={20} aria-hidden="true" /> Products
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold" dir="auto">
          {p.name}
        </h1>
        {!p.is_active ? <Badge>Inactive</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/products/${p.id}/edit`}>
          <Pencil size={18} aria-hidden="true" /> Edit
        </ButtonLink>
        <ActiveToggle endpoint="/api/products" id={p.id} version={p.version} isActive={p.is_active} name={p.name} noun="medicine" />
        {p.is_active ? (
          <WaitingLinesButton
            product={{
              id: p.id,
              name: p.name,
              unit: p.unit,
              strength: p.strength,
              dosage_form: p.dosage_form,
              pack_size: p.pack_size,
              manufacturer: p.manufacturer,
              selling_price: p.selling_price,
              is_active: p.is_active,
            }}
          />
        ) : null}
      </div>

      <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
        <Row label="Unit" value={p.unit} />
        <Row label="Strength" value={p.strength} />
        <Row label="Dosage form" value={p.dosage_form} />
        <Row label="Pack size" value={p.pack_size} />
        <Row label="Manufacturer" value={p.manufacturer} />
        <Row label="Brand" value={p.brand} />
        <Row label="Generic name" value={p.generic_name} />
        <Row label="SKU" value={p.sku} />
        <div className="py-3">
          <dt className="text-sm text-muted">Selling price</dt>
          <dd>{p.selling_price ? formatPKR(p.selling_price) : <Badge tone="warning">No selling price</Badge>}</dd>
        </div>
      </dl>

      {/* Internal figures: shown only on this owner-facing screen, never on anything customer-facing. */}
      <section aria-labelledby="internal-heading" className="space-y-1 rounded-xl border border-border bg-slate-100 p-4" data-testid="internal-panel">
        <h2 id="internal-heading" className="flex items-center gap-2 text-base font-semibold">
          <Lock size={18} aria-hidden="true" /> Internal only
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">Purchase price</dt>
            <dd>{formatPKR(p.purchase_price)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">MRP</dt>
            <dd>{formatPKR(p.mrp)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Unit gross profit</dt>
            <dd data-testid="unit-gross-profit">{p.unit_gross_profit !== null ? formatPKR(p.unit_gross_profit) : "Not available"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
