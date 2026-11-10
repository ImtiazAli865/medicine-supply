import Link from "next/link";
import { PendingPricesList } from "@/components/pending/PendingPricesList";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Pending · Medicine Supply" };
export const dynamic = "force-dynamic";

// The "To register" tab is added with the typed-medicines list (US5); until then there is one tab.
const TABS = [{ id: "prices", label: "Need a price" }] as const;

export default async function PendingPage({ searchParams }: PageProps<"/pending">) {
  await requirePageContext();
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pending</h1>
      <nav aria-label="Pending lists" className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/pending?tab=${t.id}`}
            aria-current={t.id === active.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 font-medium ${t.id === active.id ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <PendingPricesList />
    </div>
  );
}
