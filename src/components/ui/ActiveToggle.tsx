"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";

interface Props {
  endpoint: "/api/stores" | "/api/products";
  id: string;
  version: number;
  isActive: boolean;
  name: string;
  noun: "store" | "medicine";
}

/** Deactivate (with confirmation) or reactivate. Records are never deleted. */
export function ActiveToggle({ endpoint, id, version, isActive, name, noun }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setActive(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await fetchJson(`${endpoint}/${id}`, { method: "PATCH", json: { expected_version: version, is_active: next } });
      toast.show(next ? `${name} is active again.` : `${name} was deactivated.`, "success");
      setConfirming(false);
      router.refresh();
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "version_conflict") {
        toast.show(`This ${noun} was changed elsewhere. Reloading the latest version.`, "error");
        setConfirming(false);
        router.refresh();
      } else {
        toast.show(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!isActive) {
    return (
      <Button variant="secondary" onClick={() => setActive(true)} loading={busy}>
        Reactivate
      </Button>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Deactivate
      </Button>
      <Dialog open={confirming} title={`Deactivate ${noun}?`} onClose={() => setConfirming(false)}>
        <p className="text-muted">
          <strong dir="auto">{name}</strong> will be hidden from lists and suggestions. Nothing is deleted, and you can
          reactivate it later from the Inactive filter.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => setActive(false)} loading={busy}>
            Deactivate
          </Button>
        </div>
      </Dialog>
    </>
  );
}
