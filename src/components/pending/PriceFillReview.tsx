"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { formatPKR } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/number";
import type { MedicineBrief, PriceApplyResult, PriceFillPreview } from "@/lib/pending/types";
import { PriceSchema } from "@/lib/validation/pending";

// Set a selling price once, review the exact order lines it would fill, then confirm. Only lines that have no
// price yet are filled; a line that already has a price is never changed. Nothing is saved before the confirm.

type Phase = { kind: "enter" } | { kind: "review"; preview: PriceFillPreview } | { kind: "done"; result: PriceApplyResult; price: string; remaining: number };

function priceError(text: string): string | null {
  if (text.trim() === "") return "Enter the selling price.";
  const parsed = PriceSchema.safeParse(text);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Enter a valid price.");
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function PriceFillReview({ product: initial }: { product: MedicineBrief }) {
  const [product, setProduct] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ kind: "enter" });
  const [priceText, setPriceText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ testId: string; text: string; kind: "info" | "warning" } | null>(null);
  const [busy, setBusy] = useState<"review" | "fill" | "save" | null>(null);
  // One request id per reviewed list and attempt: pressing confirm twice can never fill twice.
  const requestId = useRef(newId());

  const existing = product.selling_price !== null ? PriceSchema.safeParse(String(product.selling_price)) : null;
  const existingPrice = existing?.success ? existing.data : null;

  async function review(price: string, keepNotice = false) {
    setProblem(null);
    if (!keepNotice) setNotice(null);
    setBusy("review");
    try {
      const { data } = await fetchJson<PriceFillPreview>(`/api/pending/prices/${product.id}/preview?price=${encodeURIComponent(price)}`);
      requestId.current = newId();
      setPhase({ kind: "review", preview: data });
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "invalid_price") setFieldError(error.message);
      else setProblem(error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function startFromField() {
    const message = priceError(priceText);
    setFieldError(message);
    if (message) return;
    void review(PriceSchema.parse(priceText));
  }

  async function confirm(preview: PriceFillPreview, fillLines: boolean) {
    setProblem(null);
    setNotice(null);
    setBusy(fillLines ? "fill" : "save");
    try {
      const { data } = await fetchJson<PriceApplyResult>(`/api/pending/prices/${product.id}/apply`, {
        json: { request_id: requestId.current, price: preview.price, line_ids: fillLines ? preview.lines.map((l) => l.line_id) : [], fill_lines: fillLines },
      });
      setProduct(data.product);
      if (fillLines) {
        setPhase({ kind: "done", result: data, price: preview.price, remaining: Math.max(0, preview.total_waiting - data.filled_count) });
      } else {
        setPhase({ kind: "enter" });
        setNotice({ testId: "price-saved", kind: "info", text: `The price ${formatPKR(preview.price)} is saved for this medicine. The lines that were waiting are still waiting.` });
      }
      requestId.current = newId();
    } catch (error) {
      if (error instanceof ClientApiError && error.code === "list_changed") {
        // Something changed since the review: show the new list and ask for a fresh confirm. Nothing was filled.
        setNotice({ testId: "list-changed", kind: "warning", text: "The list changed, review it again. Nothing was filled." });
        await review(preview.price, true);
        return;
      }
      if (error instanceof ClientApiError && error.code === "price_differs") {
        setProblem(error.message);
        setPhase({ kind: "enter" });
      } else {
        setProblem(error instanceof ClientApiError ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  const facts = [product.strength, product.dosage_form, product.pack_size, product.manufacturer].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4" data-testid="price-fill">
      <div>
        <h1 className="text-2xl font-semibold" dir="auto">
          {product.name}
        </h1>
        {facts ? (
          <p className="text-muted" dir="auto">
            {facts}
          </p>
        ) : null}
      </div>

      {notice ? (
        <div data-testid={notice.testId}>
          <Banner kind={notice.kind}>{notice.text}</Banner>
        </div>
      ) : null}
      {problem ? <Banner kind="error">{problem}</Banner> : null}

      {phase.kind === "enter" ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Selling price">
          {existingPrice !== null ? (
            <>
              <p>
                Selling price: <span className="font-semibold" data-testid="existing-price">{formatPKR(existingPrice)}</span>
              </p>
              <p className="text-sm text-muted">To change the price of this medicine, edit it on the Products screen. Here you can give this price to the lines that are waiting for one.</p>
              <Button onClick={() => void review(existingPrice)} loading={busy === "review"} data-testid="fill-at-price">
                Fill the waiting lines at {formatPKR(existingPrice)}
              </Button>
            </>
          ) : (
            <>
              <TextInput
                id="price"
                label="Selling price (PKR)"
                inputMode="decimal"
                autoComplete="off"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  setFieldError(null);
                }}
                error={fieldError ?? undefined}
                hint="Type the price once. It is never filled in for you."
                data-testid="price-input"
              />
              <Button onClick={startFromField} loading={busy === "review"} data-testid="price-review">
                Review the lines
              </Button>
            </>
          )}
        </section>
      ) : null}

      {phase.kind === "review" ? <ReviewPanel preview={phase.preview} hasPrice={existingPrice !== null} busy={busy} onFill={() => void confirm(phase.preview, true)} onSaveOnly={() => void confirm(phase.preview, false)} onBack={() => setPhase({ kind: "enter" })} /> : null}

      {phase.kind === "done" ? (
        <section className="space-y-3 rounded-xl border border-primary bg-primary-soft p-4" data-testid="fill-result">
          <p className="font-semibold text-primary-strong">
            Filled {plural(phase.result.filled_count, "line", "lines")} in {plural(phase.result.orders_touched, "order", "orders")} at {formatPKR(phase.price)}.
          </p>
          <p className="text-sm text-muted">The price and the new totals are on those orders, and the history of each order says what was recorded.</p>
          {phase.remaining > 0 ? (
            <>
              <p data-testid="fill-remaining">{plural(phase.remaining, "line is", "lines are")} still waiting for this price.</p>
              <Button onClick={() => void review(phase.price)} loading={busy === "review"} data-testid="fill-next">
                Review the next lines
              </Button>
            </>
          ) : null}
          <ButtonLink href="/pending?tab=prices" variant="secondary">
            Back to Pending
          </ButtonLink>
        </section>
      ) : null}
    </div>
  );
}

function ReviewPanel({
  preview,
  hasPrice,
  busy,
  onFill,
  onSaveOnly,
  onBack,
}: {
  preview: PriceFillPreview;
  hasPrice: boolean;
  busy: "review" | "fill" | "save" | null;
  onFill: () => void;
  onSaveOnly: () => void;
  onBack: () => void;
}) {
  const orders = new Set(preview.lines.map((l) => l.order_id)).size;
  const some = preview.lines.length > 0;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Review" data-testid="review-panel">
      <h2 className="text-lg font-semibold">
        {some ? (
          <>These lines will get {formatPKR(preview.price)}</>
        ) : (
          <>No order line is waiting for a price</>
        )}
      </h2>
      {some ? (
        <p data-testid="review-summary">
          {plural(preview.lines.length, "line", "lines")} in {plural(orders, "order", "orders")}.
        </p>
      ) : (
        <p className="text-muted">Confirmed orders have no line of this medicine without a price. You can still save the price for the medicine.</p>
      )}
      <p className="text-sm text-muted" data-testid="untouched-count">
        Lines that already have a price are never changed: {preview.untouched_priced_lines.toLocaleString("en-US")}.
      </p>
      {preview.total_waiting > preview.batch_limit ? (
        <Banner kind="warning">
          <span data-testid="batch-note">
            This fill covers the first {preview.batch_limit.toLocaleString("en-US")} of {preview.total_waiting.toLocaleString("en-US")} lines. Repeat it for the rest.
          </span>
        </Banner>
      ) : null}

      {some ? (
        <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="review-lines">
          {preview.lines.map((line) => (
            <li key={line.line_id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="fill-line">
              <span className="min-w-0">
                <span className="block truncate font-medium" dir="auto">
                  {line.store_name}
                </span>
                <Link href={`/orders/${line.order_id}`} className="inline-flex min-h-11 items-center text-sm text-primary underline">
                  {formatOrderNumber(line.order_number)}
                </Link>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block text-muted">Qty {line.quantity.toLocaleString("en-US")}</span>
                <span className="block font-medium">{formatPKR(line.line_total)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        {some ? (
          <Button onClick={onFill} loading={busy === "fill"} disabled={busy !== null && busy !== "fill"} data-testid="fill-confirm">
            Save price and fill these lines
          </Button>
        ) : null}
        {!hasPrice ? (
          <Button variant="secondary" onClick={onSaveOnly} loading={busy === "save"} disabled={busy !== null && busy !== "save"} data-testid="save-only">
            Save price only
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onBack} disabled={busy !== null} data-testid="review-back">
          {hasPrice ? "Go back" : "Change the price"}
        </Button>
      </div>
    </section>
  );
}
