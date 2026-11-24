import { BarChart3, BookOpen, FileWarning, Pill, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { INTERNAL_NOTE } from "@/lib/reports/labels";

export interface ReportEntry {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

// One entry per report screen that exists. A story adds its entry when its screen is built, so the hub never links to
// a page that is not there.
export const REPORTS: ReportEntry[] = [
  { href: "/reports/sales", title: "Sales and profit", description: "What you sold, the estimated profit and the realized profit.", icon: BarChart3 },
  { href: "/reports/purchases", title: "Purchases", description: "What you spent at the market, from the costs you recorded.", icon: ShoppingCart },
  { href: "/reports/stores", title: "Sales by store", description: "Which stores buy most, and the profit from each.", icon: Store },
  { href: "/reports/medicines", title: "Sales by medicine", description: "Which medicines sell most, each strength and pack on its own.", icon: Pill },
  { href: "/reports/balances", title: "Outstanding balances", description: "What each store still owes, worked out from its account.", icon: BookOpen },
  { href: "/reports/cost-missing", title: "Cost missing", description: "Sold medicines that have no cost, so a profit cannot be trusted.", icon: FileWarning },
];

export function ReportsHub() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted" data-testid="reports-internal-note">
          {INTERNAL_NOTE}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="reports-hub">
        {REPORTS.map(({ href, title, description, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-surface p-4 hover:border-primary">
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
