"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LinkMedicineDialog, type LinkTarget } from "@/components/pending/LinkMedicineDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner, ErrorState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { formatOrderNumber } from "@/lib/orders/number";
import type { Order } from "@/lib/orders/types";
import type { Candidates, LinkResult, MedicineBrief, TypedLine } from "@/lib/pending/types";

// After a medicine is registered or linked, the same typed text in other orders is proposed here, one line at a
// time. Nothing is linked until the supplier confirms that line; there is no "link all".

type LineState = { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

const candidatesUrl = (productId: string) => `/api/pending/candidates?product_id=${encodeURIComponent(productId)}`;

function LineFacts({ line }: { line: TypedLine }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span data-testid="proposal-order">
          {formatOrderNumber(line.order_number)} · <span dir="auto">{line.store_name}</span>
        </span>
        <Badge tone={line.order_status === "draft" ? "neutral" : "success"}>{line.order_status === "draft" ? "Draft" : "Confirmed"}</Badge>
      </div>
      <p className="font-semibold" dir="auto" data-testid="proposal-typed">
        {line.typed_text}
      </p>
      <p className="text-sm text-muted" data-testid="proposal-qty">
        {line.quantity.toLocaleString("en-US")} {line.unit}
      </p>
    </>
  );
}

function ProposalsList({
  product,
  initial,
  title,
  onClose,
  onManual,
  onLinked,
}: {
  product: MedicineBrief;
  initial: Candidates | null;
  title: string;
  onClose: () => void;
  onManual: (line: TypedLine) => void;
  onLinked: (result: LinkResult) => void;
}) {
  const [data, setData] = useState<Candidates | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, LineState>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // One request id per line and attempt: repeating the same attempt can never link twice.
  const requestIds = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data: fresh } = await fetchJson<Candidates>(candidatesUrl(product.id));
      setData(fresh);
    } catch (error) {
      setLoadError(error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.");
    }
  }, [product.id]);

  useEffect(() => {
    if (initial !== null) return;
    let cancelled = false;
    fetchJson<Candidates>(candidatesUrl(product.id))
      .then(({ data: fresh }) => {
        if (!cancelled) setData(fresh);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [initial, product.id]);

  const setState = (lineId: string, state: LineState | null) =>
    setStates((prev) => {
      const next = { ...prev };
      if (state) next[lineId] = state;
      else delete next[lineId];
      return next;
    });

  async function confirm(line: TypedLine) {
    setNotice(null);
    setState(line.line_id, { kind: "busy" });
    try {
      // The order's saved version is read now, when the supplier confirms, so a change made elsewhere is seen.
      const { data: order } = await fetchJson<Order>(`/api/orders/${line.order_id}`);
      const current = order.lines.find((l) => l.id === line.line_id);
      if (order.status === "cancelled" || !current || current.product_id !== null) {
        setState(line.line_id, null);
        setNotice("That line was already registered, linked or removed. The list was refreshed.");
        await load();
        return;
      }
      requestIds.current[line.line_id] ??= newId();
      const { data: result } = await fetchJson<LinkResult>(`/api/orders/${line.order_id}/lines/${line.line_id}/link`, {
        json: { request_id: requestIds.current[line.line_id], expected_version: order.version, product_id: product.id, how: "proposal", apply_price: false },
      });
      setState(line.line_id, { kind: "done" });
      onLinked(result);
    } catch (error) {
      if (error instanceof ClientApiError && (error.code === "version_conflict" || error.code === "order_not_editable" || error.code === "line_not_pending")) {
        delete requestIds.current[line.line_id];
        setState(line.line_id, null);
        setNotice(
          error.code === "line_not_pending"
            ? "That line was already registered or linked. The list was refreshed."
            : "That order was changed elsewhere. The list was refreshed. Check the line and confirm again if it is still right.",
        );
        await load();
        return;
      }
      setState(line.line_id, { kind: "error", message: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
    }
  }

  let body: ReactNode;
  if (loadError && !data) body = <ErrorState message={loadError} onRetry={() => void load()} />;
  else if (!data) body = <LoadingBlock label="Looking for matching lines…" />;
  else {
    const empty = data.proposed.length === 0 && data.not_proposed.length === 0;
    body = (
      <div className="space-y-4">
        {loadError ? <Banner kind="error">{loadError}</Banner> : null}
        {notice ? <Banner kind="warning">{notice}</Banner> : null}
        {empty ? (
          <p data-testid="proposals-empty" className="rounded-lg bg-slate-100 px-3 py-3 text-center text-muted">
            No other typed lines are waiting for this medicine.
          </p>
        ) : null}

        {data.proposed.length > 0 ? (
          <section aria-label="Lines that look like this medicine" className="space-y-2" data-testid="proposed-group">
            <p className="text-sm text-muted">These lines were typed the same way. Nothing is linked until you confirm each one. Prices are not changed here.</p>
            <ul className="space-y-2">
              {data.proposed.map((line) => {
                const state = states[line.line_id];
                return (
                  <li key={line.line_id} className="space-y-2 rounded-xl border border-border p-3" data-testid="proposal-line">
                    <LineFacts line={line} />
                    {state?.kind === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {state?.kind === "done" ? (
                        <p className="min-h-11 content-center font-medium text-primary-strong" data-testid="proposal-linked">
                          Linked
                        </p>
                      ) : (
                        <Button onClick={() => void confirm(line)} loading={state?.kind === "busy"} data-testid="proposal-confirm">
                          Link this line to {product.name}
                        </Button>
                      )}
                      <Link href={`/orders/${line.order_id}`} className="inline-flex min-h-11 items-center text-primary underline">
                        Open order
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : !empty ? (
          <p className="text-sm text-muted" data-testid="no-clear-matches">
            No line clearly matches this medicine.
          </p>
        ) : null}

        {data.not_proposed.length > 0 ? (
          <details className="rounded-xl border border-border" data-testid="not-proposed-group">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">Looks different, not proposed ({data.not_proposed.length})</summary>
            <div className="space-y-2 px-3 pb-3">
              <p className="text-sm text-muted">The strength, form or pack size may be different. These are never linked for you. If one really is this medicine, choose it yourself.</p>
              <ul className="space-y-2">
                {data.not_proposed.map((line) => (
                  <li key={line.line_id} className="space-y-2 rounded-lg border border-border p-3" data-testid="not-proposed-line">
                    <LineFacts line={line} />
                    <Button variant="secondary" onClick={() => onManual(line)} data-testid="proposal-manual">
                      This is an existing medicine
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <Dialog open title={title} onClose={onClose}>
      <p className="text-sm text-muted" dir="auto" data-testid="proposals-for">
        For <span className="font-semibold">{product.name}</span>
        {[product.strength, product.dosage_form].filter(Boolean).length > 0 ? ` · ${[product.strength, product.dosage_form].filter(Boolean).join(" · ")}` : ""}
      </p>
      {body}
      <Button variant="ghost" className="w-full" onClick={onClose} data-testid="proposals-close">
        Close
      </Button>
    </Dialog>
  );
}

export interface ProposalsRequest {
  product: MedicineBrief;
  /** Candidates already fetched (after a register or link); fetched when missing. */
  initial: Candidates | null;
  title?: string;
}

/**
 * The proposals list plus the manual "This is an existing medicine" path for a look-alike. A line of the order
 * that is open on this screen is handed back so the screen shows the server's version.
 */
export function PendingProposals({
  request,
  currentOrderId,
  onCurrentOrderChanged,
  onClose,
}: {
  request: ProposalsRequest;
  currentOrderId: string | null;
  onCurrentOrderChanged?: (order: Order) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [manual, setManual] = useState<LinkTarget | null>(null);
  const [reload, setReload] = useState(0);
  const [initial, setInitial] = useState<Candidates | null>(request.initial);

  function handleLinked(result: LinkResult) {
    if (currentOrderId !== null && result.order.id === currentOrderId) onCurrentOrderChanged?.(result.order);
  }

  async function startManual(line: TypedLine) {
    try {
      const { data: order } = await fetchJson<Order>(`/api/orders/${line.order_id}`);
      const current = order.lines.find((l) => l.id === line.line_id);
      if (order.status === "cancelled" || !current || current.product_id !== null) {
        toast.show("That line was already registered, linked or removed. The list was refreshed.", "info");
        setInitial(null);
        setReload((n) => n + 1);
        return;
      }
      setManual({
        orderId: order.id,
        orderStatus: order.status === "confirmed" ? "confirmed" : "draft",
        version: order.version,
        line: { id: line.line_id, name: line.typed_text, unit: line.unit, quantity: line.quantity },
        initial: request.product,
        how: "existing",
      });
    } catch (error) {
      toast.show(error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.", "error");
    }
  }

  function backToList() {
    setManual(null);
    setInitial(null); // fetch again: the list changed
    setReload((n) => n + 1);
  }

  return (
    <>
      {manual ? null : (
        <ProposalsList
          key={reload}
          product={request.product}
          initial={initial}
          title={request.title ?? "Link these too?"}
          onClose={onClose}
          onManual={(line) => void startManual(line)}
          onLinked={handleLinked}
        />
      )}
      <LinkMedicineDialog
        target={manual}
        onClose={backToList}
        onDone={(result) => {
          handleLinked(result);
          toast.show("Linked to the order line.", "success");
          backToList();
        }}
        onStale={(text, order) => {
          if (order && currentOrderId !== null && order.id === currentOrderId) onCurrentOrderChanged?.(order);
          toast.show(text, "info");
          backToList();
        }}
      />
    </>
  );
}

/**
 * Lets a screen offer the proposals after a register or a link. `offer` looks for matching lines and opens the
 * list only when there are some; `element` must be rendered by the screen (it outlives the line that triggered it).
 */
export function usePendingProposals(currentOrderId: string | null, onCurrentOrderChanged?: (order: Order) => void) {
  const toast = useToast();
  const [request, setRequest] = useState<ProposalsRequest | null>(null);

  const offer = useCallback(
    async (product: MedicineBrief) => {
      try {
        const { data } = await fetchJson<Candidates>(candidatesUrl(product.id));
        if (data.proposed.length > 0) setRequest({ product, initial: data });
      } catch {
        toast.show("Could not check for other lines that match. Open this medicine's page and choose Lines waiting for this medicine.", "error");
      }
    },
    [toast],
  );

  const element = request ? (
    <PendingProposals key={request.product.id} request={request} currentOrderId={currentOrderId} onCurrentOrderChanged={onCurrentOrderChanged} onClose={() => setRequest(null)} />
  ) : null;

  return { offer, element };
}
