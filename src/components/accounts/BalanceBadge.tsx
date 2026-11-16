import { Badge } from "@/components/ui/Badge";
import { balanceKind, balanceWording } from "@/lib/accounts/status";

/**
 * The balance of a store account in words: "Owes PKR 5,000.00", "Advance PKR 2,000.00" or "Settled". This is the one
 * place that turns a signed balance into words, so the list, the account screen and the Home card always agree.
 */
export function BalanceBadge({ balance, testId }: { balance: string; testId?: string }) {
  const kind = balanceKind(balance);
  const tone = kind === "owes" ? "warning" : kind === "advance" ? "success" : "neutral";
  return (
    <span data-testid={testId} data-balance-kind={kind}>
      <Badge tone={tone}>{balanceWording(balance)}</Badge>
    </span>
  );
}
