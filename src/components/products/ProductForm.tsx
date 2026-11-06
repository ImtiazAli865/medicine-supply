"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { compareMoney, isValidMoney } from "@/lib/money";
import { COMMON_UNITS, type Product, type ProductResult } from "@/lib/products/types";
import { SimilarProductsDialog, type Conflict } from "./SimilarProductsDialog";

const CUSTOM = "__custom";

interface Values {
  name: string;
  unitChoice: string;
  customUnit: string;
  brand: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
  pack_size: string;
  sku: string;
  purchase_price: string;
  selling_price: string;
  mrp: string;
}

function toValues(p?: Product): Values {
  const unit = p?.unit ?? "";
  const isCommon = (COMMON_UNITS as readonly string[]).includes(unit);
  return {
    name: p?.name ?? "",
    unitChoice: unit === "" ? "" : isCommon ? unit : CUSTOM,
    customUnit: unit !== "" && !isCommon ? unit : "",
    brand: p?.brand ?? "",
    generic_name: p?.generic_name ?? "",
    strength: p?.strength ?? "",
    dosage_form: p?.dosage_form ?? "",
    manufacturer: p?.manufacturer ?? "",
    pack_size: p?.pack_size ?? "",
    sku: p?.sku ?? "",
    purchase_price: p?.purchase_price ?? "",
    selling_price: p?.selling_price ?? "",
    mrp: p?.mrp ?? "",
  };
}

export function ProductForm({ initial }: { initial?: Product }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(initial);

  // Created once when the form opens: a retried or double-tapped save is the same record.
  const [id] = useState(() => initial?.id ?? newId());
  const [version, setVersion] = useState(initial?.version ?? 1);
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState<Conflict>(null);
  const [versionConflict, setVersionConflict] = useState<Product | null>(null);

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Non-blocking advisories computed from what is typed right now.
  const warnings = useMemo(() => {
    const out: string[] = [];
    const sell = isValidMoney(values.selling_price.trim()) ? values.selling_price.trim() : null;
    const buy = isValidMoney(values.purchase_price.trim()) ? values.purchase_price.trim() : null;
    const mrp = isValidMoney(values.mrp.trim()) ? values.mrp.trim() : null;
    if (compareMoney(sell, buy) === -1) out.push("The selling price is lower than the purchase price. You can still save.");
    if (compareMoney(mrp, sell) === -1) out.push("The MRP is lower than the selling price. You can still save.");
    return out;
  }, [values.selling_price, values.purchase_price, values.mrp]);

  function currentUnit(): string {
    return values.unitChoice === CUSTOM ? values.customUnit : values.unitChoice;
  }

  async function save(confirmSimilar: boolean) {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    setVersionConflict(null);
    try {
      const { unitChoice: _choice, customUnit: _custom, ...rest } = values;
      void _choice;
      void _custom;
      const body = { ...rest, unit: currentUnit(), confirm_similar: confirmSimilar };
      const { data } = editing
        ? await fetchJson<ProductResult>(`/api/products/${id}`, { method: "PATCH", json: { ...body, expected_version: version } })
        : await fetchJson<ProductResult>("/api/products", { json: { ...body, id } });
      toast.show(editing ? "Medicine saved." : "Medicine added.", "success");
      setConflictDialog(null);
      router.push(`/products/${data.product.id}`);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ClientApiError)) {
        setFormError("Something went wrong. Please try again.");
      } else if (e.code === "validation_error") {
        setErrors(e.fields ?? {});
        setFormError(e.fields ? null : e.message);
      } else if (e.code === "duplicate_product") {
        setConflictDialog({ kind: "duplicate", matches: (e.matches ?? []) as Product[] });
      } else if (e.code === "similar_products") {
        setConflictDialog({ kind: "similar", matches: (e.matches ?? []) as Product[] });
      } else if (e.code === "sku_conflict") {
        setErrors({ sku: e.fields?.sku ?? e.message });
      } else if (e.code === "version_conflict") {
        setVersionConflict((e.current ?? null) as Product | null);
      } else if (e.code !== "unauthenticated") {
        // Network and server errors: keep everything typed and show no success.
        setFormError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reactivate(existing: Product) {
    if (busy) return;
    setBusy(true);
    try {
      await fetchJson(`/api/products/${existing.id}`, {
        method: "PATCH",
        json: { expected_version: existing.version, is_active: true },
      });
      toast.show(`${existing.name} is active again.`, "success");
      setConflictDialog(null);
      router.push(`/products/${existing.id}`);
      router.refresh();
    } catch (e) {
      toast.show(e instanceof ClientApiError ? e.message : "Something went wrong. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  function loadLatest() {
    if (!versionConflict) return;
    setValues(toValues(versionConflict));
    setVersion(versionConflict.version);
    setVersionConflict(null);
  }

  return (
    <form onSubmit={onSubmit} data-unsaved-guard className="space-y-4" noValidate>
      {formError ? <Banner kind="error">{formError}</Banner> : null}
      {versionConflict ? (
        <Banner kind="warning">
          <strong>This medicine was changed elsewhere.</strong> Your typed values are still here. Load the latest
          version to review it, then make your changes again.{" "}
          <button type="button" onClick={loadLatest} className="min-h-11 font-semibold underline">
            Load latest
          </button>
        </Banner>
      ) : null}

      <TextInput id="name" label="Medicine name" required value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={200} />

      <Select
        id="unit"
        label="Unit"
        required
        value={values.unitChoice}
        onChange={(e) => set("unitChoice", e.target.value)}
        error={values.unitChoice === CUSTOM ? undefined : errors.unit}
      >
        <option value="">Choose a unit…</option>
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
        <option value={CUSTOM}>Other…</option>
      </Select>
      {values.unitChoice === CUSTOM ? (
        <TextInput id="custom-unit" label="Custom unit" required value={values.customUnit} onChange={(e) => set("customUnit", e.target.value)} error={errors.unit} maxLength={50} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput id="strength" label="Strength" hint="For example 500 mg" value={values.strength} onChange={(e) => set("strength", e.target.value)} error={errors.strength} maxLength={100} />
        <TextInput id="dosage_form" label="Dosage form" hint="Tablet, syrup, injection…" value={values.dosage_form} onChange={(e) => set("dosage_form", e.target.value)} error={errors.dosage_form} maxLength={100} />
        <TextInput id="pack_size" label="Pack size" value={values.pack_size} onChange={(e) => set("pack_size", e.target.value)} error={errors.pack_size} maxLength={100} />
        <TextInput id="manufacturer" label="Manufacturer" value={values.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} error={errors.manufacturer} maxLength={200} />
        <TextInput id="brand" label="Brand" value={values.brand} onChange={(e) => set("brand", e.target.value)} error={errors.brand} maxLength={200} />
        <TextInput id="generic_name" label="Generic name" value={values.generic_name} onChange={(e) => set("generic_name", e.target.value)} error={errors.generic_name} maxLength={200} />
        <TextInput id="sku" label="SKU" hint="Your own product code" value={values.sku} onChange={(e) => set("sku", e.target.value)} error={errors.sku} maxLength={100} />
      </div>

      <fieldset className="space-y-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium">Prices (PKR, optional)</legend>
        <p className="text-sm text-muted">Leave a price empty if you do not know it yet. Nothing is filled in for you.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput id="purchase_price" label="Purchase price" inputMode="decimal" value={values.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} error={errors.purchase_price} />
          <TextInput id="selling_price" label="Selling price" inputMode="decimal" value={values.selling_price} onChange={(e) => set("selling_price", e.target.value)} error={errors.selling_price} />
          <TextInput id="mrp" label="MRP" inputMode="decimal" value={values.mrp} onChange={(e) => set("mrp", e.target.value)} error={errors.mrp} />
        </div>
        {warnings.map((w) => (
          <Banner key={w} kind="warning">
            {w}
          </Banner>
        ))}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={editing ? `/products/${id}` : "/products"} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={busy}>
          {editing ? "Save changes" : "Add medicine"}
        </Button>
      </div>

      <SimilarProductsDialog
        conflict={conflictDialog}
        busy={busy}
        onClose={() => setConflictDialog(null)}
        onCreateSeparate={() => void save(true)}
        onReactivate={(p) => void reactivate(p)}
      />
    </form>
  );
}
