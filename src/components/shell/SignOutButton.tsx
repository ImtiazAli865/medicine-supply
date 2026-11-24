"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExportOffer } from "@/components/offline/ExportOffer";
import { useOffline } from "@/components/offline/OfflineProvider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const toast = useToast();
  const { status } = useOffline();
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false);

  // Orders kept on this phone that the server has not confirmed (Module 009): signing out never deletes them, but the
  // supplier is told they are not on the server and will be sent after the same business signs in again.
  const unsent = status ? status.counts.waiting + status.counts.blocked + status.counts.failed + status.counts.conflict + status.counts.syncing : 0;

  async function signOut() {
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setBusy(false);
      setWarn(false);
      toast.show("Could not sign out. Check your connection and try again.", "error");
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => (unsent > 0 ? setWarn(true) : void signOut())} loading={busy} aria-label="Sign out">
        <LogOut size={20} aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
      <Dialog open={warn} title="Orders are not on the server yet" onClose={() => (busy ? undefined : setWarn(false))}>
        <p data-testid="sign-out-warning">
          {unsent} {unsent === 1 ? "order is" : "orders are"} kept on this phone and not on the server yet. Signing out does not delete {unsent === 1 ? "it" : "them"}: {unsent === 1 ? "it is" : "they are"} sent after this business signs in again on this phone.
        </p>
        <ExportOffer count={unsent} />
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => void signOut()} loading={busy} data-testid="sign-out-anyway">
            Sign out anyway
          </Button>
          <Button variant="secondary" onClick={() => setWarn(false)} disabled={busy}>
            Stay signed in
          </Button>
        </div>
      </Dialog>
    </>
  );
}
