"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { Product } from "@/lib/products/types";

export type Conflict = { kind: "duplicate" | "similar"; matches: Product[] } | null;

function describe(p: Product): string {
  return [p.strength, p.dosage_form, p.pack_size, p.manufacturer].filter(Boolean).join(" · ") || "No other details";
}

interface Props {
  conflict: Conflict;
  busy: boolean;
  onClose: () => void;
  onCreateSeparate: () => void;
  onReactivate: (product: Product) => void;
}

/**
 * Duplicate (blocked: open or reactivate the existing product) or similar (allowed after an
 * explicit confirmation). Products are never merged automatically.
 */
export function SimilarProductsDialog({ conflict, busy, onClose, onCreateSeparate, onReactivate }: Props) {
  const duplicate = conflict?.kind === "duplicate";
  return (
    <Dialog
      open={conflict !== null}
      title={duplicate ? "This medicine already exists" : "Similar medicines exist"}
      onClose={onClose}
    >
      <p className="text-muted">
        {duplicate
          ? "A medicine with the same name, strength, form, pack size and manufacturer is already in your list."
          : "These medicines have the same name but differ in strength, form or pack size. Create a new one only if yours is different."}
      </p>
      <ul className="space-y-2">
        {(conflict?.matches ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="min-w-0" dir="auto">
              <span className="block truncate font-medium">
                {p.name}
                {!p.is_active ? <span className="text-muted"> (inactive)</span> : null}
              </span>
              <span className="block truncate text-sm text-muted">{describe(p)}</span>
            </span>
            {duplicate ? (
              p.is_active ? (
                <Link href={`/products/${p.id}`} className="inline-flex min-h-11 items-center px-2 font-semibold text-primary underline">
                  Open existing
                </Link>
              ) : (
                <Button variant="secondary" onClick={() => onReactivate(p)} loading={busy}>
                  Reactivate existing
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Go back
        </Button>
        {!duplicate ? (
          <Button onClick={onCreateSeparate} loading={busy}>
            Create as separate product
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
