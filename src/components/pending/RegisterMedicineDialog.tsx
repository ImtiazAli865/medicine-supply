"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { ClientApiError, fetchJson } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { canonicalMoney, formatPKR, isValidMoney } from "@/lib/money";
import type { Order } from "@/lib/orders/types";
import type { LinkResult, MedicineBrief } from "@/lib/pending/types";

export interface RegisterTarget {
  orderId: string;
  orderStatus: "draft" | "confirmed";
  /** The order version the screen last received (the server refuses a stale one). */
  version: number;
  line: { id: string; name: string; unit: string };
}

const LIMITS = { name: 200, unit: 50, brand: 200, generic: 200, strength: 100, form: 100, maker: 200, pack: 100, sku: 100 } as const;
const MONEY_MESSAGE = "Enter an amount in PKR with at most two decimals, like 125 or 125.50.";

type Step = "form" | "price" | "conflict";
type Conflict = { kind: "duplicate" | "similar"; matches: MedicineBrief[] };

interface Values {
  name: string;
  unit: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
  pack_size: string;
  sku: string;
  brand: string;
  generic_name: string;
  purchase_price: string;
  selling_price: string;
  mrp: string;
}

function describe(p: MedicineBrief): string {
  return [p.strength, p.dosage_form, p.pack_size, p.manufacturer].filter(Boolean).join(" · ") || "No other details";
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** Checks the form the same way the server does, so mistakes show up before anything is sent. */
function validate(v: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  if (clean(v.name) === "") errors.name = "Enter the medicine name.";
  else if (clean(v.name).length > LIMITS.name) errors.name = `Name can be at most ${LIMITS.name} characters.`;
  if (v.unit.trim() === "") errors.unit = "Choose or enter a unit.";
  else if (v.unit.trim().length > LIMITS.unit) errors.unit = `Unit can be at most ${LIMITS.unit} characters.`;
  const limits: Array<[keyof Values, number, string]> = [
    ["strength", LIMITS.strength, "Strength"],
    ["dosage_form", LIMITS.form, "Dosage form"],
    ["manufacturer", LIMITS.maker, "Manufacturer"],
    ["pack_size", LIMITS.pack, "Pack size"],
    ["sku", LIMITS.sku, "SKU"],
    ["brand", LIMITS.brand, "Brand"],
    ["generic_name", LIMITS.generic, "Generic name"],
  ];
  for (const [key, max, label] of limits) {
    if (v[key].trim().length > max) errors[key] = `${label} can be at most ${max} characters.`;
  }
  for (const key of ["purchase_price", "selling_price", "mrp"] as const) {
    if (v[key].trim() !== "" && !isValidMoney(v[key].trim())) errors[key] = MONEY_MESSAGE;
  }
  return errors;
}

function RegisterForm({
  target,
  onClose,
  onDone,
  onStale,
  onUseExisting,
}: {
  target: RegisterTarget;
  onClose: () => void;
  onDone: (result: LinkResult) => void;
  onStale: (message: string, order?: Order) => void;
  onUseExisting?: (match: MedicineBrief) => void;
}) {
  // Suggestions only: the typed text and unit are filled in, everything else stays empty and is never guessed.
  const [values, setValues] = useState<Values>({
    name: target.line.name,
    unit: target.line.unit,
    strength: "",
    dosage_form: "",
    manufacturer: "",
    pack_size: "",
    sku: "",
    brand: "",
    generic_name: "",
    purchase_price: "",
    selling_price: "",
    mrp: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // True once the supplier saw the similar medicines and chose to create a separate one.
  const [similarOk, setSimilarOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // One medicine id for this dialog; one request id per attempt (kept while the same attempt is retried).
  const productId = useRef(newId());
  const requestId = useRef(newId());

  const confirmed = target.orderStatus === "confirmed";
  const sellingPrice = values.selling_price.trim() !== "" && isValidMoney(values.selling_price.trim()) ? canonicalMoney(values.selling_price.trim()) : null;

  function set<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    requestId.current = newId(); // a changed form is a new attempt
  }

  async function submit(applyPrice: boolean, confirmSimilar: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await fetchJson<LinkResult>(`/api/orders/${target.orderId}/lines/${target.line.id}/register`, {
        json: {
          request_id: requestId.current,
          expected_version: target.version,
          product: {
            id: productId.current,
            name: clean(values.name),
            unit: values.unit.trim(),
            brand: orNull(values.brand),
            generic_name: orNull(values.generic_name),
            strength: orNull(values.strength),
            dosage_form: orNull(values.dosage_form),
            manufacturer: orNull(values.manufacturer),
            pack_size: orNull(values.pack_size),
            sku: orNull(values.sku),
            purchase_price: orNull(values.purchase_price),
            selling_price: orNull(values.selling_price),
            mrp: orNull(values.mrp),
          },
          confirm_similar: confirmSimilar,
          apply_price: applyPrice,
        },
      });
      onDone(data);
    } catch (error) {
      if (!(error instanceof ClientApiError)) {
        setProblem("Something went wrong. Please try again.");
      } else if (error.code === "duplicate_product" || error.code === "similar_products") {
        setConflict({ kind: error.code === "duplicate_product" ? "duplicate" : "similar", matches: (error.matches as MedicineBrief[]) ?? [] });
        setStep("conflict");
      } else if (error.code === "sku_conflict") {
        setErrors({ sku: error.fields?.sku ?? error.message });
        setMore(true);
        setStep("form");
      } else if (error.code === "validation_error" && error.fields) {
        setErrors(error.fields);
        if (Object.keys(error.fields).some((k) => !["name", "unit"].includes(k))) setMore(true);
        setProblem(Object.keys(error.fields).some((k) => k in values) ? null : error.message);
        setStep("form");
      } else if (error.code === "version_conflict" || error.code === "order_not_editable") {
        onStale("This order was changed elsewhere. It has been refreshed. Please try again.", error.current as Order | undefined);
      } else if (error.code === "line_not_pending") {
        onStale("This line was already registered or linked. The order has been refreshed.", error.current as Order | undefined);
      } else {
        setProblem(error.message);
        setStep("form");
      }
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (Object.keys(found).some((k) => k !== "name" && k !== "unit")) setMore(true);
      return;
    }
    // On a confirmed order the supplier decides whether the new medicine's price goes onto this line.
    if (confirmed && sellingPrice !== null) {
      setStep("price");
      return;
    }
    void submit(false, false);
  }

  if (step === "price") {
    return (
      <div className="space-y-4" data-testid="register-price-step">
        <p>
          This order is confirmed and this line has no price yet. Use <span className="font-semibold">{formatPKR(sellingPrice)}</span> for this line?
        </p>
        <p className="text-sm text-muted">If you use it, the price is recorded on the line and in the order history. If not, the line stays without a price and waits on the Need a price list.</p>
        {problem ? <Banner kind="error">{problem}</Banner> : null}
        <div className="flex flex-col gap-2">
          <Button onClick={() => void submit(true, similarOk)} loading={busy} data-testid="register-price-yes">
            Yes, use {formatPKR(sellingPrice)}
          </Button>
          <Button variant="secondary" onClick={() => void submit(false, similarOk)} disabled={busy} data-testid="register-price-no">
            No, leave the line without a price
          </Button>
          <Button variant="ghost" onClick={() => setStep("form")} disabled={busy}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  if (step === "conflict" && conflict) {
    const duplicate = conflict.kind === "duplicate";
    return (
      <div className="space-y-4" data-testid={duplicate ? "register-duplicate" : "register-similar"}>
        <p className="text-muted">
          {duplicate
            ? "A medicine with the same name, strength, form, pack size and manufacturer is already in your list. It will not be created again."
            : "These medicines have the same name but differ in strength, form, pack size or manufacturer. Create a new one only if yours is really different. They are never merged."}
        </p>
        <ul className="space-y-2">
          {conflict.matches.map((p) => (
            <li key={p.id} className="space-y-2 rounded-lg border border-border px-3 py-2" data-testid="conflict-match">
              <span className="block min-w-0" dir="auto">
                <span className="block font-medium">
                  {p.name}
                  {!p.is_active ? <span className="text-muted"> (inactive)</span> : null}
                </span>
                <span className="block text-sm text-muted">{describe(p)}</span>
              </span>
              {duplicate && p.is_active && onUseExisting ? (
                <Button variant="secondary" className="w-full" onClick={() => onUseExisting(p)} data-testid="use-existing-medicine">
                  Use the existing medicine
                </Button>
              ) : null}
              {duplicate && !p.is_active ? (
                <Link href={`/products/${p.id}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                  It is inactive: open it to reactivate
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        {problem ? <Banner kind="error">{problem}</Banner> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setStep("form")} disabled={busy}>
            Go back
          </Button>
          {!duplicate ? (
            <Button
              onClick={() => {
                setSimilarOk(true);
                if (confirmed && sellingPrice !== null) setStep("price");
                else void submit(false, true);
              }}
              loading={busy}
              data-testid="create-separate-medicine"
            >
              Create as a separate medicine
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      data-testid="register-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className="text-sm text-muted">
        The typed text and unit are only suggestions. Check them, and add only what you know: nothing is guessed.
      </p>
      <TextInput id="register-name" label="Medicine name" required value={values.name} error={errors.name} onChange={(e) => set("name", e.target.value)} />
      <TextInput id="register-unit" label="Unit" required value={values.unit} error={errors.unit} hint="For example strip, box or bottle." onChange={(e) => set("unit", e.target.value)} />

      <Button type="button" variant="ghost" className="w-full" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="register-more">
        {more ? "Hide the optional details" : "Add more details (optional)"}
      </Button>
      {more ? (
        <div className="space-y-3" data-testid="register-more-fields">
          <TextInput id="register-strength" label="Strength" value={values.strength} error={errors.strength} onChange={(e) => set("strength", e.target.value)} />
          <TextInput id="register-form" label="Dosage form" value={values.dosage_form} error={errors.dosage_form} onChange={(e) => set("dosage_form", e.target.value)} />
          <TextInput id="register-pack" label="Pack size" value={values.pack_size} error={errors.pack_size} onChange={(e) => set("pack_size", e.target.value)} />
          <TextInput id="register-maker" label="Manufacturer" value={values.manufacturer} error={errors.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
          <TextInput id="register-sku" label="SKU (code)" value={values.sku} error={errors.sku} onChange={(e) => set("sku", e.target.value)} />
          <TextInput id="register-brand" label="Brand" value={values.brand} error={errors.brand} onChange={(e) => set("brand", e.target.value)} />
          <TextInput id="register-generic" label="Generic name" value={values.generic_name} error={errors.generic_name} onChange={(e) => set("generic_name", e.target.value)} />
          <TextInput
            id="register-selling"
            label="Selling price (PKR)"
            inputMode="decimal"
            value={values.selling_price}
            error={errors.selling_price}
            hint="Leave empty if you do not know it."
            onChange={(e) => set("selling_price", e.target.value)}
          />
          <TextInput id="register-purchase" label="Purchase price (PKR)" inputMode="decimal" value={values.purchase_price} error={errors.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} />
          <TextInput id="register-mrp" label="MRP (PKR)" inputMode="decimal" value={values.mrp} error={errors.mrp} onChange={(e) => set("mrp", e.target.value)} />
        </div>
      ) : null}

      {problem ? <Banner kind="error">{problem}</Banner> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} data-testid="register-submit">
          Register and link
        </Button>
      </div>
    </form>
  );
}

/**
 * Quick Register: create the medicine from a typed line and link the line to it in one step. Only the name
 * and unit are required; the order, its quantities and every other line stay exactly as they are.
 */
export function RegisterMedicineDialog({
  target,
  onClose,
  onDone,
  onStale,
  onUseExisting,
}: {
  target: RegisterTarget | null;
  onClose: () => void;
  onDone: (result: LinkResult) => void;
  /** The order changed elsewhere (or the line was already linked): show the message and refresh the order. */
  onStale: (message: string, order?: Order) => void;
  /** An exact duplicate was found: hand the existing medicine to the link step. */
  onUseExisting?: (match: MedicineBrief) => void;
}) {
  return (
    <Dialog open={target !== null} title="Register this medicine" onClose={onClose}>
      {target ? <RegisterForm key={target.line.id} target={target} onClose={onClose} onDone={onDone} onStale={onStale} onUseExisting={onUseExisting} /> : null}
    </Dialog>
  );
}
