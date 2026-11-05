"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { SetupState } from "@/lib/settings/types";

interface Item {
  key: string;
  done: boolean;
  title: string;
  hint: string;
  href: string;
  action: string;
}

/** A short, skippable guide on Home. It never blocks anything: every item is optional. */
export function SetupChecklist({ state }: { state: SetupState }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  const items: Item[] = [
    {
      key: "details",
      done: state.details_done,
      title: "Business details and invoice settings",
      hint: "Your business name, phone, address and receipt paper width.",
      href: "/settings",
      action: "Open Settings",
    },
    {
      key: "stores",
      done: state.stores_done,
      title: "Add your stores",
      hint: "You can also add a store later, while taking your first order.",
      href: "/stores/new",
      action: "Add a store",
    },
    {
      key: "catalog",
      done: state.catalog_done,
      title: "Import your medicine list (optional)",
      hint: "From a CSV or Excel file. You can also add medicines one by one.",
      href: "/products/import",
      action: "Import a list",
    },
  ];
  const complete = items.every((i) => i.done);

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson("/api/setup/checklist", { method: "PATCH", json: { dismissed: true } });
      setHidden(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="setup-title" data-testid="setup-checklist" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 id="setup-title" className="text-lg font-semibold">{complete ? "Setup complete" : "Finish setting up"}</h2>
        <p className="text-sm text-muted">
          {complete ? "Everything on the list is done." : "Every step is optional. You can use the app right away."}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} data-testid={`setup-${item.key}`} data-done={item.done} className="flex items-start gap-3 py-3">
            {item.done ? (
              <CheckCircle2 size={24} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <Circle size={24} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.title} <span className="sr-only">{item.done ? "(done)" : "(not done)"}</span>
              </p>
              <p className="text-sm text-muted">{item.hint}</p>
              <Link href={item.href} className="inline-flex min-h-11 items-center font-medium text-primary underline">
                {item.done ? "Open" : item.action}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button variant="secondary" onClick={dismiss} loading={busy} data-testid="dismiss-checklist">
        Dismiss
      </Button>
    </section>
  );
}
