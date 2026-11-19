"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api/client";
import type { MedicinePage } from "@/lib/orders/fast-types";

export interface InactiveLine {
  id: string;
  name: string;
}

interface Candidate {
  id: string;
  product_id: string;
  name: string;
}

/** Loads the ids of every active medicine (slim pages, no price). Gives up above `limit` rows and returns null. */
async function loadActiveIds(signal: AbortSignal, limit = 6000): Promise<Set<string> | null> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "900" });
    if (cursor) params.set("cursor", cursor);
    const { data } = await fetchJson<MedicinePage>(`/api/orders/medicines?${params}`, { signal });
    for (const item of data.items) ids.add(item.id);
    if (ids.size > limit) return null;
    cursor = data.next_cursor;
  } while (cursor);
  return ids;
}

/**
 * When a save was refused because a medicine added on this screen has become inactive (the medicine list on the screen
 * was out of date), the server message names no line. This finds the catalog lines that were added since the last
 * saved version and are not in the current active list, so the screen can name them and offer to remove them.
 * `candidates` are only the new catalog lines; nothing is removed here.
 */
export function useInactiveLines(active: boolean, candidates: Candidate[]): InactiveLine[] {
  const [found, setFound] = useState<{ key: string; lines: InactiveLine[] } | null>(null);
  const key = candidates.map((c) => `${c.id}:${c.product_id}`).join(",");
  const latest = useRef(candidates);
  useEffect(() => {
    latest.current = candidates;
  });

  useEffect(() => {
    const current = latest.current;
    if (!active || current.length === 0) return;
    const controller = new AbortController();
    loadActiveIds(controller.signal)
      .then((activeIds) => {
        if (!activeIds || controller.signal.aborted) return;
        setFound({ key, lines: current.filter((c) => !activeIds.has(c.product_id)).map((c) => ({ id: c.id, name: c.name })) });
      })
      .catch(() => undefined); // the server's own message stays on screen if this check cannot run
    return () => controller.abort();
  }, [active, key]);

  return active && found?.key === key ? found.lines : [];
}
