"use client";

import { Plus, Search, Store as StoreIcon } from "lucide-react";
import { useState } from "react";
import { Banner, ErrorState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { useSearchList } from "@/lib/hooks/useSearchList";
import { newId } from "@/lib/ids";
import type { Store } from "@/lib/stores/types";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base";

function StoreButton({ store, onSelect }: { store: Store; onSelect: (s: Store) => void }) {
  return (
    <li>
      <button
        type="button"
        data-testid="store-option"
        onClick={() => onSelect(store)}
        className="flex min-h-14 w-full flex-col items-start justify-center rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
      >
        <span className="font-semibold" dir="auto">
          {store.name}
        </span>
        {store.contact_person || store.phone ? (
          <span className="text-sm text-muted" dir="auto">
            {[store.contact_person, store.phone].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * Chooses the store of an order: a searchable list of active stores, and an inline "Add new store" that
 * needs only a name. A store with the same name is offered instead of creating a duplicate.
 */
export function StoreSelector({ onSelect }: { onSelect: (store: Store) => void }) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Store[]>([]);
  // One id per add attempt: pressing the button twice or retrying never creates two stores.
  const [attemptId, setAttemptId] = useState(() => newId());
  const list = useSearchList<Store>("/api/stores", query, "active");

  async function addStore() {
    setBusy(true);
    setError(null);
    setMatches([]);
    try {
      const { data } = await fetchJson<Store>("/api/stores", { json: { id: attemptId, name } });
      setAttemptId(newId());
      onSelect(data);
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "similar_store") {
        setMatches((e.matches ?? []) as Store[]);
        setError("A store with this name already exists. Choose it below instead of adding another.");
      } else {
        setError(e instanceof ClientApiError ? (e.fields?.name ?? e.message) : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const noStoresAtAll = !list.loading && !list.error && list.items.length === 0 && list.activeQuery === "";

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search stores"
          placeholder="Search by name, contact or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="auto"
          className="min-h-11 w-full rounded-lg border border-border bg-surface py-2 pl-10 pr-3 text-base"
        />
      </div>

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : list.loading && list.items.length === 0 ? (
        <LoadingBlock label="Loading stores…" />
      ) : noStoresAtAll ? (
        <div data-testid="no-stores" className="space-y-2 rounded-xl border border-dashed border-border p-4 text-center">
          <StoreIcon size={32} className="mx-auto text-primary" aria-hidden="true" />
          <p className="font-medium">You have no stores yet.</p>
          <p className="text-sm text-muted">Add your first store with just its name, and start the order.</p>
        </div>
      ) : list.items.length === 0 ? (
        <p data-testid="no-matching-store" className="rounded-lg bg-slate-100 px-3 py-3 text-center text-muted">
          No matching store. You can add it below.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.items.map((s) => (
            <StoreButton key={s.id} store={s} onSelect={onSelect} />
          ))}
        </ul>
      )}
      {list.hasMore ? (
        <Button variant="secondary" className="w-full" onClick={list.loadMore} loading={list.loadingMore}>
          Show more
        </Button>
      ) : null}

      {adding ? (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addStore();
          }}
        >
          <div>
            <label htmlFor="new-store-name" className="mb-1 block text-sm font-medium">
              Store name
            </label>
            <input id="new-store-name" autoFocus value={name} maxLength={220} dir="auto" onChange={(e) => setName(e.target.value)} className={inputClass} />
            <p className="mt-1 text-sm text-muted">Only the name is needed. Phone and address can be added later.</p>
          </div>
          {error ? <Banner kind="error">{error}</Banner> : null}
          {matches.length > 0 ? (
            <ul className="space-y-2">
              {matches.map((s) => (
                <StoreButton key={s.id} store={s} onSelect={onSelect} />
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} disabled={name.trim() === ""} data-testid="save-new-store">
              Add store and use it
            </Button>
            <Button variant="secondary" onClick={() => { setAdding(false); setError(null); setMatches([]); }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          data-testid="add-new-store"
          onClick={() => {
            setName(query.trim());
            setAdding(true);
          }}
        >
          <Plus size={20} aria-hidden="true" />
          {noStoresAtAll ? "Add your first store" : "Add new store"}
        </Button>
      )}
    </div>
  );
}
