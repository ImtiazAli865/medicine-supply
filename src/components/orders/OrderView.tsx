import Link from "next/link";
import type { ReactNode } from "react";
import { OrderLineRow } from "@/components/orders/OrderLineRow";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { OrderTotals } from "@/components/orders/OrderTotals";
import { formatPakistanDateTime } from "@/lib/orders/dates";
import { infoFromLine } from "@/lib/orders/editor-state";
import { formatOrderNumber } from "@/lib/orders/number";
import type { Order, OrderLine } from "@/lib/orders/types";

/** A confirmed or cancelled order, read-only: prices and totals come from its own snapshot. */
export function OrderView({
  order,
  actions,
  renderLineActions,
  children,
}: {
  order: Order;
  actions?: ReactNode;
  /** Actions shown on a typed line (Register this medicine). Not used for a cancelled order. */
  renderLineActions?: (line: OrderLine) => ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold" data-testid="order-heading">
            {formatOrderNumber(order.order_number)}
          </h1>
          <p className="text-muted" dir="auto" data-testid="order-store">
            Store:{" "}
            <Link href={`/stores/${order.store.id}`} className="inline-flex min-h-11 items-center font-medium text-primary underline">
              {order.store.name}
            </Link>
          </p>
          <p className="text-sm text-muted" data-testid="order-times">
            Created {formatPakistanDateTime(order.created_at)}
            {order.confirmed_at ? ` · Confirmed ${formatPakistanDateTime(order.confirmed_at)}` : ""}
            {order.cancelled_at ? ` · Cancelled ${formatPakistanDateTime(order.cancelled_at)}` : ""}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.status === "cancelled" ? (
        <div role="status" data-testid="cancel-reason" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-danger">
          <p className="font-medium">This order was cancelled and cannot be changed.</p>
          {order.cancel_reason ? <p dir="auto">Reason: {order.cancel_reason}</p> : null}
        </div>
      ) : null}

      {actions}

      {order.lines.some((l) => l.product_id === null) ? (
        <Link href="/pending?tab=register" data-testid="pending-link" className="inline-flex min-h-11 items-center font-medium text-primary underline">
          Medicines waiting to be registered
        </Link>
      ) : null}

      <ul className="space-y-3" data-testid="order-lines">
        {order.lines.map((line) => (
          <OrderLineRow
            key={line.id}
            line={{ id: line.id, product_id: line.product_id, name: line.product_id === null ? line.name : null, quantity: line.quantity, unit: line.unit }}
            info={infoFromLine(line)}
            actions={order.status !== "cancelled" ? renderLineActions?.(line) : undefined}
            readOnly
          />
        ))}
      </ul>
      {order.lines.length === 0 ? <p className="text-muted">This order has no lines.</p> : null}

      {order.notes ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-medium text-muted">Order notes</p>
          <p dir="auto" className="whitespace-pre-wrap" data-testid="order-notes">
            {order.notes}
          </p>
        </div>
      ) : null}

      <OrderTotals lines={order.lines.map((l) => ({ quantity: l.quantity, selling_price: l.selling_price }))} />

      {children}
    </div>
  );
}
