import Link from "next/link";
import { Banner } from "@/components/ui/States";
import { blockerText } from "@/lib/invoices/status";
import type { Blocker } from "@/lib/invoices/types";

/**
 * The billed lines that have no verified selling price. They block issuing; nothing is priced by guessing. The
 * links lead to the Pending screens (Module 004) where the medicine is registered and the price is set.
 */
export function InvoiceBlockers({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null;
  const hasTyped = blockers.some((b) => b.reason === "typed");
  const hasPrice = blockers.some((b) => b.reason === "needs_price");
  return (
    <div data-testid="invoice-blockers">
      <Banner kind="warning">
        <p className="font-medium">This invoice cannot be issued yet.</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {blockers.map((blocker) => (
            <li key={blocker.line_id} dir="auto">
              {blocker.name}: {blockerText(blocker.reason)}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm">After fixing, come back and tap Refresh from order. Or set the delivered quantity of the line to 0 to leave it out.</p>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {hasTyped ? (
            <Link href="/pending?tab=register" data-testid="blockers-register-link" className="inline-flex min-h-11 items-center font-medium underline">
              Register the medicines
            </Link>
          ) : null}
          {hasPrice ? (
            <Link href="/pending?tab=prices" data-testid="blockers-prices-link" className="inline-flex min-h-11 items-center font-medium underline">
              Open Pending Prices
            </Link>
          ) : null}
        </div>
      </Banner>
    </div>
  );
}
