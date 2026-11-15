"use client";

import { FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { InvoiceActions } from "@/components/invoices/InvoiceActions";
import { InvoiceEditor } from "@/components/invoices/InvoiceEditor";
import { InvoiceView } from "@/components/invoices/InvoiceView";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { getInvoice } from "@/lib/invoices/client";
import type { Invoice } from "@/lib/invoices/types";

type Load = { kind: "error"; message: string } | { kind: "missing" } | { kind: "ready"; invoice: Invoice };

/**
 * Loads the invoice at this address and shows the right screen: the editor for a draft, the frozen read-only view
 * for an issued or a cancelled invoice. A change made on this screen (saved quantities, refresh, issue) replaces
 * what was loaded.
 */
export function InvoiceScreen({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id}|${attempt}`;
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  const [override, setOverride] = useState<Invoice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const done = (load: Load) => {
      if (!cancelled) setResult({ key, load });
    };
    getInvoice(id)
      .then((invoice) => done({ kind: "ready", invoice }))
      .catch((error: unknown) => {
        if (error instanceof ClientApiError && error.code === "not_found") return done({ kind: "missing" });
        done({ kind: "error", message: error instanceof ClientApiError ? error.message : "Something went wrong. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [id, key]);

  const load = result?.key === key ? result.load : null;
  if (!load) return <LoadingBlock label="Loading invoice…" />;
  if (load.kind === "error") return <ErrorState message={load.message} onRetry={() => setAttempt((a) => a + 1)} />;
  if (load.kind === "missing") {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Invoice not found"
        description="This invoice does not exist, it was discarded, or it belongs to another account."
        action={<ButtonLink href="/orders">Go to orders</ButtonLink>}
      />
    );
  }

  const invoice = override ?? load.invoice;
  if (invoice.status === "draft") {
    return <InvoiceEditor key={`${invoice.id}|${invoice.version}`} invoice={invoice} onInvoiceChange={setOverride} />;
  }
  return <InvoiceView key={`${invoice.id}|${invoice.version}`} invoice={invoice} actions={<InvoiceActions invoice={invoice} onInvoiceChange={setOverride} />} />;
}
