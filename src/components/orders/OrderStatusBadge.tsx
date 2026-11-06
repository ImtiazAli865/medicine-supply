import { Badge } from "@/components/ui/Badge";
import type { OrderStatus } from "@/lib/orders/types";

const LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  fulfilled: "Fulfilled",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "cancelled" ? "danger" : status === "draft" ? "neutral" : "success";
  return (
    <span data-testid="order-status">
      <Badge tone={tone}>{LABELS[status]}</Badge>
    </span>
  );
}
