"use client";

import { useState } from "react";
import { LinkMedicineDialog, type LinkTarget } from "@/components/pending/LinkMedicineDialog";
import { RegisterMedicineDialog, type RegisterTarget } from "@/components/pending/RegisterMedicineDialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Order } from "@/lib/orders/types";
import type { LinkResult, MedicineBrief } from "@/lib/pending/types";

export type VersionResult = { ok: true; version: number } | { ok: false; message: string };

/**
 * The actions of a typed (not registered) order line: Register this medicine, and This is an existing medicine.
 * The screen that shows the line says how to get the order's saved version (a draft saves first), and receives
 * the order after a change.
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
  line: { id: string; name: string; unit: string; quantity?: number };
  getVersion: () => Promise<VersionResult>;
  /** The order as the server has it after the change; the screen shows it from now on. */
  onOrderChanged: (order: Order) => void;
}) {
  const toast = useToast();
  const [register, setRegister] = useState<RegisterTarget | null>(null);
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"register" | "link" | null>(null);

  async function open(kind: "register" | "link", initial: MedicineBrief | null = null) {
    setMessage(null);
    setBusy(kind);
    const prepared = await getVersion();
    setBusy(null);
    if (!prepared.ok) {
      setMessage(prepared.message);
      return;
    }
    if (kind === "register") setRegister({ orderId, orderStatus, version: prepared.version, line });
    else setLink({ orderId, orderStatus, version: prepared.version, line, initial });
  }

  function finished(result: LinkResult, text: string) {
    setRegister(null);
    setLink(null);
    onOrderChanged(result.order);
    const priced = result.price_applied ? result.order.lines.find((l) => l.id === line.id)?.selling_price : null;
    toast.show(priced ? `${text} The line now has the price ${priced}.` : text, "success");
  }

  function stale(text: string, order?: Order) {
    setRegister(null);
    setLink(null);
    if (order) onOrderChanged(order);
    setMessage(text);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void open("register")} loading={busy === "register"} data-testid="register-medicine">
        Register this medicine
      </Button>
      <Button variant="secondary" onClick={() => void open("link")} loading={busy === "link"} data-testid="link-existing-medicine">
        This is an existing medicine
      </Button>
      {message ? (
        <p role="alert" className="w-full text-sm text-danger" data-testid="line-action-message">
          {message}
        </p>
      ) : null}
      <RegisterMedicineDialog
        target={register}
        onClose={() => setRegister(null)}
        onDone={(result) => finished(result, "Registered and linked to the order line.")}
        onStale={stale}
        onUseExisting={(match) => {
          // An exact duplicate: nothing was created; go to the comparison with the existing medicine.
          setRegister(null);
          void open("link", match);
        }}
      />
      <LinkMedicineDialog target={link} onClose={() => setLink(null)} onDone={(result) => finished(result, "Linked to the order line.")} onStale={stale} />
    </>
  );
}
