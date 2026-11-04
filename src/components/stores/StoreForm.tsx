"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea, TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import type { Store } from "@/lib/stores/types";

interface Values {
  name: string;
  contact_person: string;
  phone: string;
  address: string;
  notes: string;
}

function toValues(store?: Store): Values {
  return {
    name: store?.name ?? "",
    contact_person: store?.contact_person ?? "",
    phone: store?.phone ?? "",
    address: store?.address ?? "",
    notes: store?.notes ?? "",
  };
}

export function StoreForm({ initial }: { initial?: Store }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(initial);

  // The id is created once when the form opens, so a retried or double-tapped save is the same record.
  const [id] = useState(() => initial?.id ?? newId());
  const [version, setVersion] = useState(initial?.version ?? 1);
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Store[] | null>(null);
  const [conflict, setConflict] = useState<Store | null>(null);

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save(confirmDuplicate: boolean) {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setConflict(null);
    try {
      const body = { ...values, confirm_duplicate: confirmDuplicate };
      const { data } = editing
        ? await fetchJson<Store>(`/api/stores/${id}`, { method: "PATCH", json: { ...body, expected_version: version } })
        : await fetchJson<Store>("/api/stores", { json: { ...body, id } });
      toast.show(editing ? "Store saved." : "Store added.", "success");
      setSimilar(null);
      router.push(`/stores/${data.id}`);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ClientApiError)) {
        setFormError("Something went wrong. Please try again.");
      } else if (e.code === "validation_error") {
        setErrors(e.fields ?? {});
        setFormError(e.fields ? null : e.message);
      } else if (e.code === "similar_store") {
        setSimilar((e.matches ?? []) as Store[]);
      } else if (e.code === "version_conflict") {
        setConflict((e.current ?? null) as Store | null);
      } else if (e.code !== "unauthenticated") {
        // Network and server errors: keep everything typed, show no success.
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  function loadLatest() {
    if (!conflict) return;
    setValues(toValues(conflict));
    setVersion(conflict.version);
    setConflict(null);
  }

  return (
    <form onSubmit={onSubmit} data-unsaved-guard className="space-y-4" noValidate>
      {formError ? <Banner kind="error">{formError}</Banner> : null}
      {conflict ? (
        <Banner kind="warning">
          <strong>This store was changed elsewhere.</strong> Your typed values are still here. Load the latest version to
          review it, then make your changes again.{" "}
          <button type="button" onClick={loadLatest} className="min-h-11 font-semibold underline">
            Load latest
          </button>
        </Banner>
      ) : null}

      <TextInput id="name" label="Store name" required value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={200} />
      <TextInput id="contact_person" label="Contact person" value={values.contact_person} onChange={(e) => set("contact_person", e.target.value)} error={errors.contact_person} maxLength={200} />
      <TextInput id="phone" label="Phone" type="tel" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} maxLength={50} />
      <TextArea id="address" label="Address" value={values.address} onChange={(e) => set("address", e.target.value)} error={errors.address} maxLength={500} />
      <TextArea id="notes" label="Notes" value={values.notes} onChange={(e) => set("notes", e.target.value)} error={errors.notes} maxLength={1000} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={editing ? `/stores/${id}` : "/stores"} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={busy}>
          {editing ? "Save changes" : "Add store"}
        </Button>
      </div>

      <Dialog open={similar !== null} title="A store with this name exists" onClose={() => setSimilar(null)}>
        <p className="text-muted">These stores already have this name. Create another one only if it is a different store.</p>
        <ul className="space-y-1">
          {(similar ?? []).map((s) => (
            <li key={s.id} className="rounded-lg border border-border px-3 py-2" dir="auto">
              {s.name}
              {s.phone ? <span className="text-muted"> · {s.phone}</span> : null}
              {!s.is_active ? <span className="text-muted"> (inactive)</span> : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setSimilar(null)}>
            Go back
          </Button>
          <Button onClick={() => void save(true)} loading={busy}>
            {editing ? "Save anyway" : "Add anyway"}
          </Button>
        </div>
      </Dialog>
    </form>
  );
}
