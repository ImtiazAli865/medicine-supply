import { ClientApiError, fetchJson } from "@/lib/api/client";
import type { PreviewState } from "./preview-state";

// FR-028: the server checks every line again when the draft is created. When it refuses because a medicine on the order
// is no longer usable (deactivated or removed after the preview was made), the supplier must be told WHICH line. The order
// save answers with one sentence for the whole order, so the screen asks the existing medicine read about each catalog
// line and names the ones that are no longer active. Only the `is_active` flag is read; nothing else of the record is used.

export interface UnusableLine {
  key: string;
  /** What the supplier said, or the name they chose when it differs. */
  label: string;
  reason: "inactive" | "missing";
}

export type MedicineStatus = "active" | "inactive" | "missing" | "unknown";

/** Pure: which lines of the preview point at a medicine that is not active any more. */
export function unusableLines(state: PreviewState, statusOf: (productId: string) => MedicineStatus): UnusableLine[] {
  const found: UnusableLine[] = [];
  for (const line of state.lines) {
    if (line.choice?.kind !== "catalog") continue;
    const status = statusOf(line.choice.productId);
    if (status !== "inactive" && status !== "missing") continue;
    const chosen = line.choice.name;
    found.push({ key: line.key, label: chosen && chosen !== line.spoken ? `${line.spoken} (${chosen})` : line.spoken, reason: status });
  }
  return found;
}

/** The sentence shown in place of the order save's general one. */
export function describeUnusable(lines: UnusableLine[]): string {
  const names = lines.map((line) => `"${line.label}"`).join(", ");
  return lines.length === 1
    ? `The medicine on the line ${names} is no longer available in your catalog. Remove that line or add the medicine as typed, then create the order again. Nothing was created.`
    : `The medicines on these lines are no longer available in your catalog: ${names}. Remove those lines or add them as typed, then create the order again. Nothing was created.`;
}

const BATCH = 8;

/** Reads the status of each distinct catalog medicine of the preview. A failed read counts as unknown, never as unusable. */
export async function readMedicineStatuses(state: PreviewState): Promise<Map<string, MedicineStatus>> {
  const ids = [...new Set(state.lines.flatMap((line) => (line.choice?.kind === "catalog" ? [line.choice.productId] : [])))];
  const statuses = new Map<string, MedicineStatus>();
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(
      ids.slice(i, i + BATCH).map(async (id) => {
        try {
          const { data } = await fetchJson<{ is_active?: boolean }>(`/api/products/${id}`);
          statuses.set(id, data.is_active === false ? "inactive" : "active");
        } catch (error) {
          statuses.set(id, error instanceof ClientApiError && error.code === "not_found" ? "missing" : "unknown");
        }
      }),
    );
  }
  return statuses;
}

/** After a refused create: the lines that are no longer usable, or an empty list when none could be found. */
export async function findUnusableLines(state: PreviewState): Promise<UnusableLine[]> {
  const statuses = await readMedicineStatuses(state);
  return unusableLines(state, (id) => statuses.get(id) ?? "unknown");
}
