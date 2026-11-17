import type { Candidate } from "./types";

/**
 * The only fields of a catalog medicine the voice preview ever holds. A medicine picked by the supplier in the search
 * dialog arrives as a full catalog record; this keeps its identity and description and drops everything else, so no
 * price, cost, margin or profit can reach the preview, the stored copy of it or the draft request.
 */
export interface PickedMedicine {
  id: string;
  name: string;
  unit: string;
  brand?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  manufacturer?: string | null;
  pack_size?: string | null;
}

export function candidateFromMedicine(medicine: PickedMedicine): Candidate {
  return {
    id: medicine.id,
    name: medicine.name,
    unit: medicine.unit,
    brand: medicine.brand ?? null,
    strength: medicine.strength ?? null,
    dosage_form: medicine.dosage_form ?? null,
    manufacturer: medicine.manufacturer ?? null,
    pack_size: medicine.pack_size ?? null,
    is_exact: false,
  };
}
