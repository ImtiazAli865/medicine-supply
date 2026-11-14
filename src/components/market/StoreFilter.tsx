"use client";

import { Store } from "lucide-react";
import type { MarketStore } from "@/lib/market/types";

/**
 * Choose which stores the list shows and prints. Nothing selected means all stores. Bought and remaining figures
 * still refer to the whole day (the screen says so while a store is selected).
 */
export function StoreFilter({ stores, selected, onChange }: { stores: MarketStore[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (stores.length === 0) return null;
  const label = selected.length === 0 ? "All stores" : selected.length === 1 ? "1 store selected" : `${selected.length} stores selected`;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <details className="rounded-lg border border-border bg-surface" data-testid="store-filter">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-base font-medium">
        <Store size={20} aria-hidden="true" />
        {label}
      </summary>
      <div className="space-y-1 border-t border-border p-2">
        {stores.map((s) => (
          <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-slate-100">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="size-5" data-testid="store-option" />
            <span className="min-w-0 break-words">{s.name}</span>
          </label>
        ))}
        {selected.length > 0 ? (
          <button type="button" onClick={() => onChange([])} className="min-h-11 rounded-lg px-3 text-base font-medium text-primary hover:bg-primary-soft" data-testid="store-clear">
            Show all stores
          </button>
        ) : null}
      </div>
    </details>
  );
}
