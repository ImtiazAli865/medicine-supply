// Autosave for an order: a small, framework-free state machine (research D7).
//
// Rules it keeps:
//  - edits are debounced and coalesced into ONE request; only one request is in flight at a time;
//  - the first save sends expected_version null (creation); every later save sends the version the
//    previous response returned, and a NEW request id;
//  - a failed request that may or may not have reached the server is retried with the SAME request id and
//    payload (the server replays it instead of applying it twice); only network failures and 5xx are retried
//    automatically, 400/401/404/409-type answers are not;
//  - an edit made while a request is being retried waits until that request is resolved, so a person's own
//    earlier change can never be reported as "changed elsewhere";
//  - "saved" is reported only after the server confirmed the change; a conflict stops autosaving and keeps
//    the local edits; flush() lets Confirm, Discard and leaving the page wait for every edit to be saved.
//
// Module 009 adds an OPTIONAL journal and canSend(). With a journal the machine keeps every change on the device before it
// says so ("on_device" = kept on this device, not confirmed by the server), keeps the request that has no answer yet (with
// its id) BEFORE it is sent so a retry after a restart repeats exactly that request, and does not send while canSend() is
// false. Without a journal the machine behaves exactly as before.

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "not_saved" | "changed_elsewhere" | "on_device";

export interface SaveRequest<S> {
  /** Created on the device; the same id is reused when the same request is retried. */
  requestId: string;
  /** null for the first save of a new order; otherwise the version the screen was based on. */
  expectedVersion: number | null;
  state: S;
}

export type SaveOutcome<O> =
  | { kind: "ok"; version: number; savedAt: string; order: O }
  /** The order was changed elsewhere (or is no longer editable): `current` is the server's version. */
  | { kind: "conflict"; current: O }
  /** The server could not be reached or answered 5xx: the request may or may not have been applied. */
  | { kind: "retryable"; message: string }
  /** The server refused the request (400, 401, 404 ...): retrying the same request cannot help. */
  | { kind: "fatal"; message: string; /** A refusal that names the medicines or the store (the order is held, nothing is dropped). */ reason?: "line_problem" | "store_problem" };

/** What the journal keeps for one order (everything needed to come back after a restart). */
export interface DurableSnapshot<S, O> {
  /** The phone version: what the screen shows. */
  state: S;
  /** The version the next request will be based on (null before the first server save). */
  version: number | null;
  /** The request that has no answer yet (null when none). */
  pending: SaveRequest<S> | null;
  /** The server's order when the last save found it changed elsewhere. */
  conflict: O | null;
  /** The order the server returned for the latest confirmed save. */
  serverOrder: O | null;
  /** True when nothing is waiting: the screen state is what the server confirmed. */
  synced: boolean;
}

export interface AutosaveJournal<S, O> {
  /** Resolves when the snapshot is kept on the device; rejects (with a plain message) when it could not be kept. */
  write(snapshot: DurableSnapshot<S, O>): Promise<void>;
}

export interface AutosaveOptions<S, O> {
  send: (request: SaveRequest<S>) => Promise<SaveOutcome<O>>;
  newId: () => string;
  equals?: (a: S, b: S) => boolean;
  /** Quiet time after the last edit before saving (default 800 ms). */
  debounceMs?: number;
  /** Attempts for one request before it is shown as "Not saved" (default 3). */
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
  /**
   * Manual mode (editing a confirmed order): edits are never saved on their own; they are saved only when
   * flush() is called (the "Save changes" button), so each save is one reviewed change.
   */
  manual?: boolean;
  /** Keeps every change on the device (Module 009). */
  journal?: AutosaveJournal<S, O>;
  /** False while nothing may be sent (offline, paused, another tab is the sender). Checked before every send. */
  canSend?: () => boolean;
}

export interface AutosaveSnapshot<S, O> {
  /** The screen's latest state (what the person sees). */
  state: S;
  status: AutosaveStatus;
  /** True from the first unsaved edit until the server has confirmed it. */
  isDirty: boolean;
  /** The server's last-saved time of the latest confirmed save. */
  lastSavedAt: string | null;
  /** The version the next request will be based on (null before the first save). */
  version: number | null;
  error: string | null;
  /** The server's order when the save found it changed elsewhere. */
  conflict: O | null;
  /** The order the server returned for the latest confirmed save. */
  serverOrder: O | null;
}

export interface Autosave<S, O> {
  /** The screen's latest state. */
  edit(next: S): void;
  getLocalState(): S;
  /** Resolves when every edit is confirmed by the server; rejects when the save fails, finds a conflict or can only be kept on the device. */
  flush(): Promise<void>;
  /** Tries the unsaved change again now (the "Retry" button). */
  retry(): void;
  /** After a conflict: take the server's version as both the screen state and the saved state. */
  adopt(state: S, version: number, order: O): void;
  /** After a conflict: keep the phone version, take the server's order as the base, and send the phone version again. */
  rebase(serverState: S, version: number, order: O): void;
  getSnapshot(): AutosaveSnapshot<S, O>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export const ON_DEVICE_MESSAGE = "This order is saved on this phone only for now. It is sent when the connection returns.";

export function createAutosave<S, O>(
  options: AutosaveOptions<S, O>,
  initial: {
    state: S;
    version: number | null;
    savedAt?: string | null;
    order?: O | null;
    /** What the server has (defaults to `state`); differs from `state` for unsent changes recovered from the journal. */
    confirmed?: S;
    /** A request that had no answer yet when the app was closed (recovered from the journal). */
    pending?: SaveRequest<S> | null;
    conflict?: O | null;
  },
): Autosave<S, O> {
  const equals = options.equals ?? ((a: S, b: S) => JSON.stringify(a) === JSON.stringify(b));
  const debounceMs = options.debounceMs ?? 800;
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? ((attempt: number) => 1000 * attempt);
  const journal = options.journal;

  let local = initial.state;
  let confirmed = initial.confirmed ?? initial.state;
  let version = initial.version;
  let lastSavedAt = initial.savedAt ?? null;
  let serverOrder: O | null = initial.order ?? null;
  let error: string | null = null;
  let conflict: O | null = initial.conflict ?? null;

  let pending: SaveRequest<S> | null = initial.pending ?? null; // a request whose outcome is not known yet
  const recoveredUnsent = pending !== null || !equals(local, confirmed);
  let status: AutosaveStatus = conflict !== null ? "changed_elsewhere" : journal && recoveredUnsent ? "on_device" : initial.savedAt ? "saved" : "idle";
  let inFlight = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // The journal: one write at a time; a change made during a write is written right after it.
  let writing: Promise<boolean> | null = null;
  let writeAgain = false;
  let journalOk = true;
  let journalMessage: string | null = null;

  const listeners = new Set<() => void>();
  const waiters: Array<{ resolve: () => void; reject: (reason: Error) => void }> = [];

  const isDirty = () => !equals(local, confirmed) || pending !== null;
  const canSendNow = () => (options.canSend ? options.canSend() : true);

  let snapshot: AutosaveSnapshot<S, O> = build();

  function build(): AutosaveSnapshot<S, O> {
    return { state: local, status, isDirty: isDirty(), lastSavedAt, version, error, conflict, serverOrder };
  }

  function notify() {
    snapshot = build();
    for (const listener of Array.from(listeners)) listener();
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(ms: number) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  }

  function durable(): DurableSnapshot<S, O> {
    return { state: local, version, pending, conflict, serverOrder, synced: !isDirty() && conflict === null };
  }

  /** Writes the current state to the journal. Resolves true when it was kept, false when it could not be kept. */
  function persist(): Promise<boolean> {
    if (!journal) return Promise.resolve(true);
    if (writing) {
      writeAgain = true;
      return writing;
    }
    const job = (async () => {
      do {
        writeAgain = false;
        try {
          await journal.write(durable());
          journalOk = true;
          journalMessage = null;
        } catch (e) {
          journalOk = false;
          journalMessage = e instanceof Error && e.message ? e.message : "This phone could not keep the change.";
        }
      } while (writeAgain && !disposed);
      return journalOk;
    })();
    writing = job.finally(() => {
      writing = null;
    });
    return writing;
  }

  /** Settles flush() callers when the machine has reached a resting state. */
  function settle() {
    if (waiters.length === 0) return;
    if (status === "changed_elsewhere") {
      for (const w of waiters.splice(0)) w.reject(new Error("This order was changed elsewhere."));
    } else if (status === "not_saved") {
      const message = error ?? "The order could not be saved.";
      for (const w of waiters.splice(0)) w.reject(new Error(message));
    } else if (status === "on_device") {
      for (const w of waiters.splice(0)) w.reject(new Error(ON_DEVICE_MESSAGE));
    } else if (!isDirty() && !inFlight) {
      for (const w of waiters.splice(0)) w.resolve();
    }
  }

  /** Nothing can be sent now: keep the change on the device and say so (or say that it could not be kept). */
  async function parkOnDevice(): Promise<void> {
    const kept = await persist();
    if (disposed || inFlight) return;
    if (!isDirty()) {
      settle();
      return;
    }
    if (status === "changed_elsewhere") return;
    if (kept) {
      status = "on_device";
      error = null;
    } else {
      status = "not_saved";
      error = journalMessage;
    }
    notify();
    settle();
  }

  async function run(): Promise<void> {
    if (disposed || inFlight || status === "changed_elsewhere") return;

    if (journal && !canSendNow()) {
      await parkOnDevice();
      return;
    }

    let request = pending;
    if (!request) {
      if (equals(local, confirmed)) {
        settle();
        return;
      }
      request = { requestId: options.newId(), expectedVersion: version, state: local };
      pending = request;
    }

    inFlight = true;
    status = "saving";
    error = null;
    notify();

    // The request is kept on the device BEFORE it is sent, so a retry after a restart repeats exactly this request.
    if (journal) {
      await persist();
      if (disposed) return;
    }

    let outcome: SaveOutcome<O>;
    try {
      outcome = await options.send(request);
    } catch {
      outcome = { kind: "retryable", message: "Can't reach the server. Check your connection and try again." };
    }
    inFlight = false;
    if (disposed) return;

    switch (outcome.kind) {
      case "ok":
        version = outcome.version;
        confirmed = request.state;
        lastSavedAt = outcome.savedAt;
        serverOrder = outcome.order;
        pending = null;
        attempts = 0;
        error = null;
        if (!equals(local, confirmed)) {
          // An edit arrived while this request was in flight: send it now, without waiting for the delay.
          void persist();
          void run();
          return;
        }
        status = "saved";
        notify();
        void persist();
        settle();
        return;

      case "conflict":
        pending = null;
        attempts = 0;
        conflict = outcome.current;
        status = "changed_elsewhere";
        notify();
        void persist();
        settle();
        return;

      case "fatal":
        pending = null; // the server did not apply it; the next edit makes a new request
        attempts = 0;
        error = outcome.message;
        status = "not_saved";
        notify();
        void persist();
        settle();
        return;

      case "retryable":
        attempts += 1;
        error = outcome.message;
        if (attempts < maxAttempts) {
          status = "saving";
          notify();
          schedule(backoffMs(attempts));
        } else if (journal) {
          // The request stays on the device (with its id); the sync centre sends it again when it can.
          status = journalOk ? "on_device" : "not_saved";
          if (!journalOk) error = journalMessage;
          notify();
          settle();
        } else {
          status = "not_saved";
          notify();
          settle();
        }
        return;
    }
  }

  return {
    edit(next) {
      if (disposed) return;
      local = next;
      if (options.manual) {
        notify();
        return;
      }
      if (status === "changed_elsewhere") {
        notify();
        void persist(); // the phone version stays on the device
        return;
      }
      if (inFlight) {
        notify(); // picked up right after the running request
        void persist();
        return;
      }
      if (pending === null && equals(local, confirmed)) {
        clearTimer();
        // The screen is back to exactly what the server has (for example after Undo or removing the line that could not be
        // saved): there is nothing unsaved any more, so a stale "Not saved" must not stay on screen.
        if (status === "pending" || status === "not_saved" || status === "on_device") {
          status = lastSavedAt ? "saved" : "idle";
          error = null;
        }
        notify();
        void persist();
        settle();
        return;
      }
      if (status === "not_saved" || status === "on_device") attempts = 0; // a new edit gives the unsaved change another chance
      status = "pending";
      notify();
      if (journal && !canSendNow()) {
        clearTimer();
        void parkOnDevice(); // kept on the device first, then reported as such
        return;
      }
      void persist().then((kept) => {
        // Only a failed journal write matters here: the server's answer decides the rest.
        if (!kept && !disposed && status === "pending" && !inFlight && !canSendNow()) void parkOnDevice();
      });
      schedule(debounceMs);
    },

    getLocalState: () => local,

    flush() {
      if (status === "changed_elsewhere") return Promise.reject(new Error("This order was changed elsewhere."));
      if (!isDirty() && !inFlight) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        if (!inFlight) {
          clearTimer();
          if (status === "not_saved" || status === "on_device") attempts = 0;
          void run();
        }
      });
    },

    retry() {
      if (disposed || status === "changed_elsewhere") return;
      attempts = 0;
      clearTimer();
      void run();
    },

    adopt(state, newVersion, order) {
      clearTimer();
      local = state;
      confirmed = state;
      version = newVersion;
      serverOrder = order;
      conflict = null;
      pending = null;
      attempts = 0;
      error = null;
      status = "saved";
      notify();
      void persist();
      settle();
    },

    rebase(serverState, newVersion, order) {
      if (disposed) return;
      clearTimer();
      confirmed = serverState;
      version = newVersion;
      serverOrder = order;
      conflict = null;
      pending = null;
      attempts = 0;
      error = null;
      if (equals(local, confirmed)) {
        status = "saved";
        notify();
        void persist();
        settle();
        return;
      }
      status = "pending";
      notify();
      void persist();
      schedule(0);
    },

    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      disposed = true;
      clearTimer();
      listeners.clear();
      for (const w of waiters.splice(0)) w.reject(new Error("The editor was closed."));
    },
  };
}
