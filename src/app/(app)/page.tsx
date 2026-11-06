import { Pill, Store } from "lucide-react";
import Link from "next/link";
import { SetupChecklist } from "@/components/setup/SetupChecklist";
import { requirePageContext } from "@/lib/api/auth";
import { getSetupState } from "@/lib/setup/repository";

export const metadata = { title: "Home · Medicine Supply" };
export const dynamic = "force-dynamic";

const cards = [
  { href: "/products", title: "Products", description: "Your medicine list, prices and units.", icon: Pill },
  { href: "/stores", title: "Stores", description: "The pharmacies you supply.", icon: Store },
] as const;

export default async function HomePage() {
  const { supabase } = await requirePageContext();
  // Setup state is derived from real data; if it cannot be loaded, Home still works without the card.
  const setup = await getSetupState(supabase).catch(() => null);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Home</h1>
      {setup && !setup.dismissed ? <SetupChecklist state={setup} /> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map(({ href, title, description, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-surface p-4 hover:border-primary"
            >
              <Icon size={32} className="shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="block text-lg font-semibold">{title}</span>
                <span className="block text-muted">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
