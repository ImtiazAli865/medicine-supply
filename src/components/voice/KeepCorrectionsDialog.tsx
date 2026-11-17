"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

/**
 * Asked when the supplier reads the order again after correcting lines by hand: keep those corrections, or start from
 * the new reading. The app does exactly what is chosen. Cancel changes nothing.
 */
export function KeepCorrectionsDialog({
  open,
  onKeep,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title="Keep your corrections?" onClose={onCancel}>
      <div data-testid="keep-corrections-dialog" className="space-y-3">
        <p>You changed this order by hand. When the text is read again, do you want to keep those changes?</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Keep: every line you changed or added, and the store you chose, stay as they are. Lines you did not change are replaced by the new reading. A line you removed stays removed.</li>
          <li>Discard: the new reading replaces everything, including your changes.</li>
        </ul>
        <div className="flex flex-col gap-2">
          <Button onClick={onKeep} data-testid="voice-keep-corrections">
            Keep my corrections
          </Button>
          <Button variant="danger" onClick={onDiscard} data-testid="voice-discard-corrections">
            Discard my corrections
          </Button>
          <Button variant="secondary" onClick={onCancel} data-testid="voice-keep-cancel">
            Cancel, change nothing
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
