"use client";

import { useState } from "react";
import { RegisterMedicineDialog, type RegisterTarget } from "@/components/pending/RegisterMedicineDialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Order } from "@/lib/orders/types";

export type VersionResult = { ok: true; version: number } | { ok: false; message: string };

/**
 * The actions of a typed (not registered) order line: Register this medicine. The screen that shows the line
 * says how to get the order's saved version (a draft saves first), and receives the order after a change.
 */
export function PendingLineActions({
  orderId,
  orderStatus,
  line,
  getVersion,
  onOrderChanged,
}: {
  orderId: string;
  orderStatus: "draft" | "confirmed";
  line: { id: string; name: string; unit: string };
  getVersion: () => Promise<VersionResult>;
  /** The order as the server has it after the change; the screen shows it from now on. */
  onOrderChanged: (order: Order) => void;
}) {
  const toast = useToast();
  const [target, setTarget] = useState<RegisterTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openRegister() {
    setMessage(null);
    setBusy(true);
    const prepared = await getVersion();
    setBusy(false);
    if (!prepared.ok) {
      setMessage(prepared.message);
      return;
    }
    setTarget({ orderId, orderStatus, version: prepared.version, line });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void openRegister()} loading={busy} data-testid="register-medicine">
        Register this medicine
      </Button>
      {message ? (
        <p role="alert" className="w-full text-sm text-danger" data-testid="line-action-message">
          {message}
        </p>
      ) : null}
      <RegisterMedicineDialog
        target={target}
        onClose={() => setTarget(null)}
        onDone={(result) => {
          setTarget(null);
          onOrderChanged(result.order);
          toast.show(result.price_applied ? `Registered. The line now has the price ${result.order.lines.find((l) => l.id === line.id)?.selling_price ?? ""}.` : "Registered and linked to the order line.", "success");
        }}
        onStale={(text, order) => {
          setTarget(null);
          if (order) onOrderChanged(order);
          setMessage(text);
        }}
      />
    </>
  );
}
