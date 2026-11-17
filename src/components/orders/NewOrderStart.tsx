"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { VoiceOrderPanel } from "@/components/voice/VoiceOrderPanel";
import { newId } from "@/lib/ids";

/**
 * Step one of a new order: speak the order, or choose (or add) the store. Nothing is saved yet; the order is created
 * on the server by the first change on the next screen, or by "Create draft order" on the voice preview. The order id
 * is made here and goes into the address.
 */
export function NewOrderStart() {
  const router = useRouter();
  // While a voice preview is open it takes the whole screen; the store selector comes back when it closes.
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">New order</h1>
        {previewOpen ? null : <p className="text-muted">Speak the order, or choose the store this order is for.</p>}
      </div>
      <VoiceOrderPanel onPreviewChange={setPreviewOpen} />
      {previewOpen ? null : (
        <section aria-labelledby="manual-heading" className="space-y-3">
          <h2 id="manual-heading" className="text-lg font-semibold">
            Or take the order by hand
          </h2>
          <StoreSelector onSelect={(store) => router.replace(`/orders/${newId()}?store=${store.id}`)} />
        </section>
      )}
    </div>
  );
}
