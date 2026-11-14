"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { formatPKR } from "@/lib/money";
import type { Product } from "@/lib/products/types";

interface Props {
  productId: string;
  productName: string;
  /** The actual unit cost just recorded, canonical PKR like "88.50". */
  cost: string;
  /** Called when the offer is finished (answered, closed, or not needed). */
  onDone: () => void;
}

type State = { kind: "loading" } | { kind: "ask"; product: Product };

/**
 * After a purchase with an actual cost: offer to update the medicine's current purchase price to that cost. Only
 * "Yes, update" changes anything (through the normal product update); "No" and closing change nothing. It never
 * touches a selling price, an MRP or any order line. When the price is already that cost, or the medicine cannot
 * be read, nothing is offered.
 */
export function UpdateCostOffer({ productId, productName, cost, onDone }: Props) {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<Product>(`/api/products/${productId}`)
      .then(({ data }) => {
        if (!alive) return;
        if (data.purchase_price === cost) onDone();
        else setState({ kind: "ask", product: data });
      })
      .catch(() => alive && onDone()); // the offer is optional: if the medicine cannot be read, do not ask
    return () => {
      alive = false;
    };
    // The offer is shown once for one recorded purchase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, cost]);

  async function update(product: Product) {
    setSaving(true);
    setFailure(null);
    try {
      await fetchJson(`/api/products/${product.id}`, { method: "PATCH", json: { expected_version: product.version, purchase_price: cost } });
      toast.show(`Purchase price of ${productName} is now ${formatPKR(cost)}.`, "success");
      onDone();
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "version_conflict" && error.current) {
        // The medicine changed meanwhile: show its new state and ask again.
        setState({ kind: "ask", product: error.current as Product });
        setFailure("This medicine was changed elsewhere. Please check and answer again.");
      } else {
        setFailure(error instanceof ClientApiError ? error.message : "The price was not updated. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") return null;
  const { product } = state;

  return (
    <Dialog open title="Update the purchase price?" onClose={onDone}>
      <div className="space-y-4" data-testid="update-cost-offer">
        <p>
          Update the current purchase price of <span className="font-semibold">{productName}</span> to <span className="font-semibold">{formatPKR(cost)}</span>?
        </p>
        <p className="text-sm text-muted">
          Now: {product.purchase_price ? formatPKR(product.purchase_price) : "no purchase price"}. Your selling price and the prices on orders do not change.
        </p>
        {failure ? <Banner kind="error">{failure}</Banner> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onDone} disabled={saving} data-testid="keep-cost">
            No, keep the current price
          </Button>
          <Button loading={saving} onClick={() => update(product)} data-testid="update-cost-yes">
            Yes, update
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
