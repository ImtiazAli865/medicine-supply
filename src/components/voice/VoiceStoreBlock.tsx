"use client";

import { useState } from "react";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/States";
import type { PreviewAction, EditableStore } from "@/lib/voice/preview-state";

const STATE_LABEL = {
  matched: { text: "Matched", tone: "success" },
  choose_one: { text: "Choose one", tone: "warning" },
  unknown: { text: "Not found", tone: "danger" },
  not_named: { text: "No store named", tone: "warning" },
} as const;

/**
 * The store of the order. The spoken store is matched by the app, never by the AI: matched (one exact store), choose
 * one (several or similar: nothing preselected), or not found. The supplier can always choose any store or add a new
 * one inline (the same selector and duplicate check as the manual order). A store must be chosen before the draft can
 * be created.
 */
export function VoiceStoreBlock({
  store,
  moreThanOne,
  dispatch,
}: {
  store: EditableStore;
  moreThanOne: boolean;
  dispatch: (action: PreviewAction) => void;
}) {
  const [changing, setChanging] = useState(false);
  const label = STATE_LABEL[store.state];
  const chosen = store.storeId !== null;
  const showSelector = !chosen || changing;

  return (
    <section aria-labelledby="voice-store-heading" className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="voice-store" data-store-state={store.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="voice-store-heading" className="text-lg font-semibold">
          Store
        </h2>
        <Badge tone={chosen ? "success" : label.tone}>{chosen ? "Chosen" : label.text}</Badge>
      </div>

      {store.spoken ? (
        <p className="text-sm text-muted" dir="auto">
          You said: <span className="font-medium text-foreground">{store.spoken}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">No store was named. Choose the store for this order.</p>
      )}

      {moreThanOne ? (
        <Banner kind="warning">More than one store was named. An order is for one store: choose the store for this order. Items are never split into several orders.</Banner>
      ) : null}

      {chosen ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold" dir="auto" data-testid="voice-store-name">
            {store.name}
          </p>
          <button type="button" className="inline-flex min-h-11 items-center px-2 text-primary underline" onClick={() => setChanging((v) => !v)} data-testid="voice-store-change">
            {changing ? "Keep this store" : "Change store"}
          </button>
        </div>
      ) : null}

      {!chosen && store.candidates.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Did you mean one of these? Nothing is chosen for you.</p>
          <ul className="space-y-2">
            {store.candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  data-testid="voice-store-candidate"
                  onClick={() => dispatch({ type: "choose_store", store: { id: candidate.id, name: candidate.name } })}
                  className="flex min-h-14 w-full flex-col items-start justify-center rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-primary"
                >
                  <span className="font-semibold" dir="auto">
                    {candidate.name}
                  </span>
                  {candidate.contact_person || candidate.phone ? (
                    <span className="text-sm text-muted" dir="auto">
                      {[candidate.contact_person, candidate.phone].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showSelector ? (
        <div className="space-y-2" data-testid="voice-store-selector">
          <p className="text-sm font-medium">{chosen ? "Choose another store" : "Or choose any store, or add a new one"}</p>
          <StoreSelector
            onSelect={(picked) => {
              dispatch({ type: "choose_store", store: { id: picked.id, name: picked.name } });
              setChanging(false);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
