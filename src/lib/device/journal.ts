// The draft journal (Module 009, data-model.md): one record per draft that has a change the server has not confirmed (and the
// last server copy of drafts opened here). Every write is one storage operation guarded by `rev`, so two tabs can never
// overwrite each other silently and a crash leaves the record either as before or as after. Nothing here reads the clock to
// decide anything: the order of sending is a counter (`seq`).

import type { EditorState, LineInfo } from "@/lib/orders/editor-state";
import type { BusinessDatabase, DraftRecord } from "./schema";

export type JournalWrite =
  | { ok: true; draft: DraftRecord }
  /** Someone else (another tab) changed the record since the writer read it. */
  | { ok: false; reason: "rev_conflict"; stored: DraftRecord | null }
  /** The device storage refused the write (full, blocked). The previous record is unchanged. */
  | { ok: false; reason: "storage"; message: string };

export const STORAGE_FAILED_MESSAGE = "This phone could not keep the change (its storage is full or blocked).";

export function emptyDraft(orderId: string, state: EditorState, lineInfo: Record<string, LineInfo>, updatedOnDevice: string): DraftRecord {
  return {
    orderId,
    rev: 0,
    seq: 0,
    state,
    lineInfo,
    baseVersion: null,
    inflight: null,
    serverOrder: null,
    syncState: "on_device",
    reason: null,
    conflict: null,
    tries: 0,
    nextTryTick: 0,
    neverSent: true,
    updatedOnDevice,
  };
}

export class Journal {
  constructor(private readonly db: BusinessDatabase) {}

  get(orderId: string): Promise<DraftRecord | undefined> {
    return this.db.get("drafts", orderId);
  }

  /** Drafts with a change the server has not confirmed, in the order they were first changed. */
  async listUnsynced(): Promise<DraftRecord[]> {
    const all = await this.db.getAll("drafts");
    return all.filter((d) => d.syncState !== "synced").sort((a, b) => a.seq - b.seq);
  }

  private async nextSeq(): Promise<number> {
    const current = ((await this.db.get("meta", "journalSeq"))?.value as number | undefined) ?? 0;
    const next = current + 1;
    await this.db.put("meta", { key: "journalSeq", value: next });
    return next;
  }

  /**
   * Reads the stored record, builds the new one from it, and writes it only if the stored `rev` is still `expectedRev`
   * (null when the writer expects no record). The new record gets rev + 1; a draft that becomes unsynced after being
   * synced (or new) gets the next `seq`.
   */
  async apply(orderId: string, expectedRev: number | null, build: (current: DraftRecord | undefined) => DraftRecord): Promise<JournalWrite> {
    try {
      const stored = await this.db.get("drafts", orderId);
      const storedRev = stored ? stored.rev : null;
      if (storedRev !== expectedRev) return { ok: false, reason: "rev_conflict", stored: stored ?? null };
      const next = build(stored);
      next.orderId = orderId;
      next.rev = (stored?.rev ?? 0) + 1;
      const becomesUnsynced = next.syncState !== "synced" && (!stored || stored.syncState === "synced");
      next.seq = becomesUnsynced ? await this.nextSeq() : (stored?.seq ?? next.seq);
      const result = await this.db.putDraftIfRev(next, expectedRev);
      if (!result.ok) return { ok: false, reason: "rev_conflict", stored: result.stored };
      return { ok: true, draft: next };
    } catch {
      return { ok: false, reason: "storage", message: STORAGE_FAILED_MESSAGE };
    }
  }

  /** Marks a draft as confirmed by the server: the server order becomes the base, nothing is waiting any more. */
  markSynced(
    orderId: string,
    expectedRev: number,
    server: { order: DraftRecord["serverOrder"]; version: number },
    confirmedState?: EditorState,
  ): Promise<JournalWrite> {
    return this.apply(orderId, expectedRev, (current) => {
      if (!current) throw new Error("There is no draft to mark as synced.");
      return {
        ...current,
        state: confirmedState ?? current.state,
        baseVersion: server.version,
        serverOrder: server.order,
        inflight: null,
        syncState: "synced",
        reason: null,
        conflict: null,
        tries: 0,
        nextTryTick: 0,
        neverSent: false,
      };
    });
  }

  /** Removes a draft that never reached the server. A draft that exists on the server is never removed here. */
  async discardNeverSent(orderId: string): Promise<{ ok: true } | { ok: false; reason: "on_server" | "storage" }> {
    try {
      const stored = await this.db.get("drafts", orderId);
      if (!stored) return { ok: true };
      if (!stored.neverSent) return { ok: false, reason: "on_server" };
      await this.db.remove("drafts", orderId);
      return { ok: true };
    } catch {
      return { ok: false, reason: "storage" };
    }
  }
}
