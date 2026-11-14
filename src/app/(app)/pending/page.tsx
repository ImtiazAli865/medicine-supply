import Link from "next/link";
import { PendingPricesList } from "@/components/pending/PendingPricesList";
import { TypedGroupList } from "@/components/pending/TypedGroupList";
import { requirePageContext } from "@/lib/api/auth";
import { pendingSummary } from "@/lib/pending/repository";

export const metadata = { title: "Pending · Medicine Supply" };
export const dynamic = "force-dynamic";

type TabId = "register" | "prices";

export default async function PendingPage({ searchParams }: PageProps<"/pending">) {
  const { supabase } = await requirePageContext();
  const { tab, q } = await searchParams;
  // An optional search text (the market list links to a typed medicine this way). Limited like the search box.
  const initialQuery = (Array.isArray(q) ? q[0] : q)?.slice(0, 200) ?? "";
  // The counts on the tabs come from the same summary as Home. If it cannot be read the tabs simply have no counts.
  const summary = await pendingSummary(supabase).catch(() => null);

  const requested = Array.isArray(tab) ? tab[0] : tab;
  const active: TabId = requested === "register" || requested === "prices" ? requested : summary && summary.typed_lines > 0 ? "register" : "prices";
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "register", label: summary ? `To register (${summary.typed_groups.toLocaleString("en-US")})` : "To register" },
    { id: "prices", label: summary ? `Need a price (${summary.price_items.toLocaleString("en-US")})` : "Need a price" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pending</h1>
      <nav aria-label="Pending lists" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/pending?tab=${t.id}`}
            data-testid={`pending-tab-${t.id}`}
            aria-current={t.id === active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 font-medium ${t.id === active ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {active === "register" ? <TypedGroupList initialQuery={initialQuery} /> : <PendingPricesList />}
    </div>
  );
}
