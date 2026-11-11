import Link from "next/link";
import { formatPakistanTime } from "@/lib/orders/dates";
import { formatOrderNumber } from "@/lib/orders/number";
import type { OrderSummary } from "@/lib/orders/types";

/** The newest unfinished drafts, so an interrupted order is one tap away from Home. Hidden when there are none. */
export function ContinueOrders({ orders }: { orders: OrderSummary[] }) {
  if (orders.length === 0) return null;
  return (
    <section aria-labelledby="continue-heading" className="space-y-2" data-testid="continue-orders">
      <h2 id="continue-heading" className="text-lg font-semibold">
        Continue order
      </h2>
      <ul className="space-y-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/orders/${order.id}`}
              data-testid="continue-order"
              className="flex min-h-14 flex-col justify-center rounded-xl border border-border bg-surface px-4 py-2 hover:border-primary"
            >
              <span className="font-semibold">
                {formatOrderNumber(order.order_number)} · <span dir="auto">{order.store.name}</span>
              </span>
              <span className="text-sm text-muted">
                {order.line_count} {order.line_count === 1 ? "line" : "lines"} · saved at {formatPakistanTime(order.updated_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
