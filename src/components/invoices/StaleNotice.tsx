"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";

/**
 * The order changed after this draft was made (a quantity, a line, a link or a price). The draft cannot be issued
 * until it is rebuilt from the order, which also puts the delivered quantities back to the order values.
 */
export function StaleNotice({ onRefresh, busy, hasUnsaved }: { onRefresh: () => void; busy: boolean; hasUnsaved: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="stale-notice">
      <Banner kind="warning">
        <p className="font-medium">The order has changed.</p>
        <p>This draft no longer matches its order, so it cannot be issued. Refresh it from the order, then check the delivered quantities again.</p>
        <div className="mt-2">
          <Button variant="secondary" onClick={() => setOpen(true)} data-testid="refresh-from-order">
            <RefreshCw size={18} aria-hidden="true" />
            Refresh from order
          </Button>
        </div>
      </Banner>
      <Dialog open={open} title="Refresh from the order?" onClose={() => (busy ? undefined : setOpen(false))}>
        <div className="space-y-3">
          <p>The lines are rebuilt from the order and the delivered quantities go back to the order values. Please check them again before issuing.</p>
          {hasUnsaved ? <p className="text-warning">Quantities you typed but did not save will be lost.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy}
              data-testid="refresh-confirm"
              onClick={() => {
                onRefresh();
                setOpen(false);
              }}
            >
              Refresh
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Keep the draft
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
