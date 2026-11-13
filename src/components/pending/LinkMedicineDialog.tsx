"use client";

import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner, ErrorState } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useSearchList } from "@/lib/hooks/useSearchList";
import { newId } from "@/lib/ids";
import { formatPKR } from "@/lib/money";
import type { Order } from "@/lib/orders/types";
import type { LinkResult, MedicineBrief } from "@/lib/pending/types";
import type { Product } from "@/lib/products/types";

export interface LinkTarget {
  orderId: string;
  orderStatus: "draft" | "confirmed";
  version: number;
  line: { id: string; name: string; unit: string; quantity?: number };
  /** An exact duplicate found while registering: go straight to the comparison. */
  initial?: MedicineBrief | null;
  /** "proposal" when the link comes from the proposals list. */
  how?: "existing" | "proposal";
}

/** The facts of a medicine the comparison needs: no purchase price, no MRP. */
function brief(p: Product | MedicineBrief): MedicineBrief {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    strength: p.strength,
    dosage_form: p.dosage_form,
    pack_size: p.pack_size,
    manufacturer: p.manufacturer,
    selling_price: p.selling_price,
    is_active: p.is_active,
  };
}

const FACTS: Array<[string, keyof MedicineBrief]> = [
  ["Strength", "strength"],
  ["Dosage form", "dosage_form"],
  ["Pack size", "pack_size"],
  ["Manufacturer", "manufacturer"],
];

function Picker({ onPick }: { onPick: (product: Product) => void }) {
  const [query, setQuery] = useState("");
  const list = useSearchList<Product>("/api/products", query, "active");
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          autoFocus
          aria-label="Search medicines"
          placeholder="Name, strength, form, maker or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>
      <div className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="link-results">
        {list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : list.loading && list.items.length === 0 ? (
          <LoadingBlock label="Searching…" />
        ) : list.items.length === 0 ? (
          <p data-testid="no-matching-medicine" className="rounded-lg bg-slate-100 px-3 py-3 text-center text-muted">
            {list.activeQuery === "" ? "Your catalog is empty. Register this medicine instead." : "No matching medicine. Check the spelling or register it instead."}
          </p>
        ) : (
          <ul className="space-y-2">
            {list.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid="link-result"
                  onClick={() => onPick(p)}
                  className="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
                >
                  <span className="font-semibold" dir="auto">
                    {p.name}
                  </span>
                  <span className="text-sm text-muted" dir="auto">
                    {[p.strength, p.dosage_form, p.pack_size, p.manufacturer].filter(Boolean).join(" · ") || "No other details"}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    Unit: {p.unit}
                    {p.selling_price === null ? <Badge tone="warning">No selling price</Badge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.hasMore ? (
          <Button variant="secondary" className="w-full" onClick={list.loadMore} loading={list.loadingMore}>
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LinkFlow({
  target,
  onClose,
  onDone,
  onStale,
}: {
  target: LinkTarget;
  onClose: () => void;
  onDone: (result: LinkResult) => void;
  onStale: (message: string, order?: Order) => void;
}) {
  const [picked, setPicked] = useState<MedicineBrief | null>(target.initial ? brief(target.initial) : null);
  const [step, setStep] = useState<"search" | "confirm" | "price">(target.initial ? "confirm" : "search");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const requestId = useRef(newId());

  const confirmed = target.orderStatus === "confirmed";

  async function submit(applyPrice: boolean) {
    if (!picked) return;
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await fetchJson<LinkResult>(`/api/orders/${target.orderId}/lines/${target.line.id}/link`, {
        json: { request_id: requestId.current, expected_version: target.version, product_id: picked.id, how: target.how ?? "existing", apply_price: applyPrice },
      });
      onDone(data);
    } catch (error) {
      if (!(error instanceof ClientApiError)) {
        setProblem("Something went wrong. Please try again.");
      } else if (error.code === "version_conflict" || error.code === "order_not_editable") {
        onStale("This order was changed elsewhere. It has been refreshed. Please try again.", error.current as Order | undefined);
      } else if (error.code === "line_not_pending") {
        onStale("This line was already registered or linked. The order has been refreshed.", error.current as Order | undefined);
      } else {
        setProblem(error.message);
        setStep("confirm");
      }
    } finally {
      setBusy(false);
    }
  }

  function choose() {
    if (confirmed && picked?.selling_price) setStep("price");
    else void submit(false);
  }

  if (step === "search") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Pick the medicine this line is. Nothing is linked until you confirm.</p>
        <Picker
          onPick={(p) => {
            setPicked(brief(p));
            requestId.current = newId();
            setStep("confirm");
          }}
        />
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!picked) return null;

  if (step === "price") {
    return (
      <div className="space-y-4" data-testid="link-price-step">
        <p>
          This order is confirmed and this line has no price yet. Use <span className="font-semibold">{formatPKR(picked.selling_price)}</span> for this line?
        </p>
        <p className="text-sm text-muted">If you use it, the price is recorded on the line and in the order history. If not, the line stays without a price and waits on the Need a price list.</p>
        {problem ? <Banner kind="error">{problem}</Banner> : null}
        <div className="flex flex-col gap-2">
          <Button onClick={() => void submit(true)} loading={busy} data-testid="link-price-yes">
            Yes, use {formatPKR(picked.selling_price)}
          </Button>
          <Button variant="secondary" onClick={() => void submit(false)} disabled={busy} data-testid="link-price-no">
            No, leave the line without a price
          </Button>
          <Button variant="ghost" onClick={() => setStep("confirm")} disabled={busy}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="link-confirm">
      <p className="text-sm text-muted">Compare what was typed with the medicine you picked. If the strength, form or pack size is different, go back and pick another.</p>
      <div className="space-y-2 rounded-xl border border-border p-3" data-testid="link-typed">
        <p className="text-sm font-medium text-muted">Typed on the order</p>
        <p className="font-semibold" dir="auto">
          {target.line.name}
        </p>
        <p className="text-sm text-muted">
          {target.line.quantity !== undefined ? `${target.line.quantity.toLocaleString("en-US")} ` : ""}
          {target.line.unit}
        </p>
      </div>
      <div className="space-y-2 rounded-xl border border-primary p-3" data-testid="link-picked">
        <p className="text-sm font-medium text-muted">Medicine you picked</p>
        <p className="font-semibold" dir="auto">
          {picked.name}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {FACTS.map(([label, key]) => (
            <div key={key} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd dir="auto">{(picked[key] as string | null) || "—"}</dd>
            </div>
          ))}
          <dt className="text-muted">Unit</dt>
          <dd>{picked.unit}</dd>
        </dl>
      </div>
      {problem ? <Banner kind="error">{problem}</Banner> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => (target.initial ? onClose() : setStep("search"))} disabled={busy}>
          {target.initial ? "Cancel" : "Pick another"}
        </Button>
        <Button onClick={choose} loading={busy} data-testid="link-confirm-button">
          Link this line to {picked.name}
        </Button>
      </div>
    </div>
  );
}

/** Link a typed line to a medicine that already exists, after the supplier picks it and confirms the comparison. */
export function LinkMedicineDialog({
  target,
  onClose,
  onDone,
  onStale,
}: {
  target: LinkTarget | null;
  onClose: () => void;
  onDone: (result: LinkResult) => void;
  onStale: (message: string, order?: Order) => void;
}) {
  return (
    <Dialog open={target !== null} title="This is an existing medicine" onClose={onClose}>
      {target ? <LinkFlow key={`${target.line.id}:${target.initial?.id ?? ""}`} target={target} onClose={onClose} onDone={onDone} onStale={onStale} /> : null}
    </Dialog>
  );
}
