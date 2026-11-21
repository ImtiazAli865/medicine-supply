"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Banner } from "@/components/ui/States";
import { availableChoices, describeChoice, diffLines, type Choice } from "@/lib/device/conflict";
import type { ConflictRecord } from "@/lib/device/schema";
import type { EditorState, LineInfo } from "@/lib/orders/editor-state";

const CHOICE_LABEL: Record<Choice, string> = {
  keep_phone: "Keep the phone version",
  keep_server: "Keep the server version",
  keep_both: "Keep both as separate orders",
};

const CHOICE_TEST_ID: Record<Choice, string> = { keep_phone: "keep-phone", keep_server: "keep-server", keep_both: "keep-both" };

const REASON: Record<ConflictRecord["kind"], string> = {
  changed: "This order was changed on the server after the version on this phone was started.",
  not_editable: "This order was confirmed or cancelled on the server, so the changes on this phone cannot be applied to it.",
  missing: "This order is no longer on the server.",
  line_problem: "",
  store_problem: "",
};

/**
 * The phone version and the server version side by side, with the choices (Module 009, FR-018). Nothing changes on either
 * side until the supplier chooses, and every choice first shows what will be replaced or lost and asks to confirm.
 */
export function ConflictPanel({
  phone,
  lineInfo,
  conflict,
  onChoose,
}: {
  phone: EditorState;
  lineInfo: Record<string, LineInfo>;
  conflict: ConflictRecord;
  onChoose: (choice: Choice) => Promise<void>;
}) {
  const [pending, setPending] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = diffLines(phone, lineInfo, conflict.server);
  const choices = availableChoices(conflict);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await onChoose(pending);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="conflict-panel" role="alert" aria-label="This order needs your decision" className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-3">
      <h2 className="text-lg font-semibold text-warning">This order needs your decision</h2>
      <p className="text-sm">{REASON[conflict.kind]} Nothing has been changed on the server or on this phone.</p>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div data-testid="conflict-phone" className="space-y-1 rounded-lg bg-surface p-2">
          <p className="font-semibold">On this phone ({phone.lines.length})</p>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={`p-${r.key}`} className={r.differs && r.phone ? "font-medium" : undefined}>
                {r.phone ? (
                  <span dir="auto">
                    {r.phone.name} · {r.phone.quantity} {r.phone.unit}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="conflict-server" className="space-y-1 rounded-lg bg-surface p-2">
          <p className="font-semibold">On the server{conflict.server ? ` (${conflict.server.lines.length}${conflict.server.status !== "draft" ? `, ${conflict.server.status}` : ""})` : ""}</p>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={`s-${r.key}`} className={r.differs && r.server ? "font-medium" : undefined}>
                {r.server ? (
                  <span dir="auto">
                    {r.server.name} · {r.server.quantity} {r.server.unit}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {choices.map((choice) => (
          <Button key={choice} variant={choice === "keep_phone" ? "primary" : "secondary"} data-testid={CHOICE_TEST_ID[choice]} onClick={() => setPending(choice)}>
            {CHOICE_LABEL[choice]}
          </Button>
        ))}
      </div>

      <Dialog open={pending !== null} title={pending ? CHOICE_LABEL[pending] : ""} onClose={() => (busy ? undefined : setPending(null))}>
        {pending ? (
          <>
            <p data-testid="conflict-confirm-text">{describeChoice(pending, phone, conflict)}</p>
            {error ? <Banner kind="error">{error}</Banner> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant={pending === "keep_server" ? "danger" : "primary"} onClick={confirm} loading={busy} data-testid="conflict-confirm">
                {pending === "keep_server" ? "Delete the phone version" : pending === "keep_phone" ? "Replace the server order" : "Make a separate order"}
              </Button>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                Go back
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
