import Link from "next/link";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { formatPKR } from "@/lib/money";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { formatOrderNumber } from "@/lib/orders/number";
import type { OrderSummary } from "@/lib/orders/types";

/** One order in the history: number, store, date, status, size and the total of its priced lines. */
export function OrderListItem({ order }: { order: OrderSummary }) {
  const lines = `${order.line_count} ${order.line_count === 1 ? "line" : "lines"}`;
  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        data-testid="order-list-item"
        className="block min-h-14 space-y-1 rounded-xl border border-border bg-surface p-3 hover:border-primary"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold" data-testid="order-list-number">
            {formatOrderNumber(order.order_number)}
          </span>
          <OrderStatusBadge status={order.status} />
        </span>
        <span className="block font-medium" dir="auto">
          {order.store.name}
        </span>
        <span className="block text-sm text-muted">{formatPakistanDateTime(order.created_at)}</span>
        <span className="block text-sm">
          {lines}
          {order.line_count > 0 && order.line_count > order.unpriced_lines ? ` · ${formatPKR(order.priced_total)}` : ""}
          {order.unpriced_lines > 0 ? (
            <span className="text-warning"> · {order.unpriced_lines} without price</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
