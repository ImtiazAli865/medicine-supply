"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/States";
import { RATE_CONFLICT_EVENT } from "@/lib/orders/save-transport";

/** Said once, and kept until closed: a store rate that changed elsewhere was not replaced by a send (Module 012). */
export function RateConflictNotice() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = () => setShown(true);
    window.addEventListener(RATE_CONFLICT_EVENT, show);
    return () => window.removeEventListener(RATE_CONFLICT_EVENT, show);
  }, []);
  if (!shown) return null;
  return (
    <div className="mb-3 space-y-2" data-testid="rate-conflict-notice">
      <Banner kind="warning">
        A store&apos;s saved rate was changed elsewhere, so it was not replaced. The order was saved with your price. Check the rate on the store&apos;s page.
      </Banner>
      <Button variant="secondary" onClick={() => setShown(false)}>
        Close this notice
      </Button>
    </div>
  );
}
