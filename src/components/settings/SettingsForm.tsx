"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea, TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { Settings } from "@/lib/settings/types";

interface Values {
  name: string;
  phone: string;
  address: string;
  paper: string;
  summary: boolean;
}

function toValues(s: Settings): Values {
  return {
    name: s.name,
    phone: s.phone ?? "",
    address: s.address ?? "",
    paper: String(s.thermal_paper_mm),
    summary: s.account_summary_default,
  };
}

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Settings | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [dismissed, setDismissed] = useState(initial.checklist_dismissed);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setConflict(null);
    try {
      const paperText = values.paper.trim();
      const { data } = await fetchJson<Settings>("/api/settings", {
        method: "PATCH",
        json: {
          expected_version: saved.version,
          name: values.name,
          phone: values.phone,
          address: values.address,
          // A whole number is sent as a number; anything else is sent as typed so the server explains the problem.
          thermal_paper_mm: /^\d+$/.test(paperText) ? Number(paperText) : paperText,
          account_summary_default: values.summary,
        },
      });
      setSaved(data);
      setValues(toValues(data));
      toast.show("Settings saved.", "success");
      router.refresh(); // the business name in the header comes from the saved setting
    } catch (e) {
      if (!(e instanceof ClientApiError)) {
        setFormError("Something went wrong. Please try again.");
      } else if (e.code === "validation_error") {
        const fields = { ...(e.fields ?? {}) };
        if (fields.thermal_paper_mm) fields.paper = fields.thermal_paper_mm;
        setErrors(fields);
        if (!e.fields) setFormError(e.message);
      } else if (e.code === "version_conflict") {
        setConflict((e.current ?? null) as Settings | null);
      } else if (e.code !== "unauthenticated") {
        // Network and server errors: everything typed stays, and no success message appears.
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function loadLatest() {
    if (!conflict) return;
    setSaved(conflict);
    setValues(toValues(conflict));
    setDismissed(conflict.checklist_dismissed);
    setConflict(null);
  }

  async function showChecklist() {
    setChecklistBusy(true);
    try {
      await fetchJson("/api/setup/checklist", { method: "PATCH", json: { dismissed: false } });
      setDismissed(false);
      toast.show("The setup checklist will show on Home.", "success");
      router.refresh();
    } catch (e) {
      toast.show(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.", "error");
    } finally {
      setChecklistBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} data-unsaved-guard className="space-y-4" noValidate>
        {formError ? <Banner kind="error">{formError}</Banner> : null}
        {conflict ? (
          <div data-testid="settings-conflict">
            <Banner kind="warning">
              <strong>These settings were changed elsewhere.</strong> Your typed values are still here. Load the latest
              version to review it, then make your changes again.{" "}
              <button type="button" onClick={loadLatest} className="min-h-11 font-semibold underline">
                Load latest
              </button>
            </Banner>
          </div>
        ) : null}

        <section className="space-y-4" aria-labelledby="business-title">
          <h2 id="business-title" className="text-lg font-semibold">Business</h2>
          <TextInput id="name" label="Business name" required value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={200} />
          <TextInput id="phone" label="Phone" type="tel" inputMode="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} maxLength={50} />
          <TextArea id="address" label="Address" value={values.address} onChange={(e) => set("address", e.target.value)} error={errors.address} maxLength={500} />
        </section>

        <section className="space-y-4" aria-labelledby="invoice-title">
          <h2 id="invoice-title" className="text-lg font-semibold">Invoice settings</h2>
          <TextInput
            id="paper"
            label="Thermal receipt paper width (mm)"
            inputMode="numeric"
            value={values.paper}
            onChange={(e) => set("paper", e.target.value)}
            error={errors.paper}
            hint="Whole number from 40 to 120. 80 is the most common; 58 is also common."
          />
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              id="summary"
              className="mt-1 size-6"
              checked={values.summary}
              onChange={(e) => set("summary", e.target.checked)}
            />
            <span>
              <span className="block font-medium">Print the Account Summary on invoices by default</span>
              <span className="block text-sm text-muted">Off by default. Invoices are not printed yet; this is stored for when they are.</span>
            </span>
          </label>
          {errors.account_summary_default ? <p role="alert" className="text-sm text-danger">{errors.account_summary_default}</p> : null}
        </section>

        <Button type="submit" loading={busy} data-testid="save-settings">
          Save settings
        </Button>
      </form>

      <section className="space-y-2 border-t border-border pt-4" aria-labelledby="checklist-title">
        <h2 id="checklist-title" className="text-lg font-semibold">Setup checklist</h2>
        {dismissed ? (
          <>
            <p className="text-muted">The checklist is hidden on Home.</p>
            <Button variant="secondary" onClick={showChecklist} loading={checklistBusy}>
              Show setup checklist
            </Button>
          </>
        ) : (
          <p className="text-muted">The setup checklist is showing on Home. You can dismiss it there.</p>
        )}
      </section>
    </div>
  );
}
