"use client";

import { ListChecks } from "lucide-react";
import { useState } from "react";
import { PendingProposals } from "@/components/pending/ProposalsFlow";
import { Button } from "@/components/ui/Button";
import type { MedicineBrief } from "@/lib/pending/types";

/**
 * On a medicine's own page: open the list of typed order lines that look like this medicine, so they can be linked
 * one by one. Only reads until the supplier confirms a line.
 */
export function WaitingLinesButton({ product }: { product: MedicineBrief }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="waiting-lines">
        <ListChecks size={18} aria-hidden="true" /> Lines waiting for this medicine
      </Button>
      {open ? <PendingProposals request={{ product, initial: null, title: "Lines waiting for this medicine" }} currentOrderId={null} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
