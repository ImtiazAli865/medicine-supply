import { notFound } from "next/navigation";
import { ChevronLeft, ClipboardList, Pencil } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { ActiveToggle } from "@/components/ui/ActiveToggle";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { getStore } from "@/lib/stores/repository";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="whitespace-pre-line" dir="auto">
        {value || <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}

export default async function StoreDetailPage({ params }: PageProps<"/stores/[id]">) {
  const { id } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  return (
    <div className="space-y-4">
      <Link href="/stores" className="inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft size={20} aria-hidden="true" /> Stores
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold" dir="auto">
          {store.name}
        </h1>
        {!store.is_active ? <Badge>Inactive</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/stores/${store.id}/edit`}>
          <Pencil size={18} aria-hidden="true" /> Edit
        </ButtonLink>
        <ButtonLink href={`/orders?store=${store.id}`} variant="secondary">
          <ClipboardList size={18} aria-hidden="true" /> Orders
        </ButtonLink>
        <ActiveToggle endpoint="/api/stores" id={store.id} version={store.version} isActive={store.is_active} name={store.name} noun="store" />
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
        <Row label="Contact person" value={store.contact_person} />
        <Row label="Phone" value={store.phone} />
        <Row label="Address" value={store.address} />
        <Row label="Notes" value={store.notes} />
      </dl>
    </div>
  );
}
