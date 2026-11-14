"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Opens the browser's print dialog (which also offers "Save as PDF"). Hidden on the printed page. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} data-testid="print-now">
      <Printer size={20} aria-hidden="true" />
      Print
    </Button>
  );
}
