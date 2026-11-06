import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type SaveOutcome, type SaveRequest } from "@/lib/orders/autosave";

// The autosave machine is pure: these tests drive it with fake timers and a fake server that can
// fail, lose a response after applying a request, replay a repeated request id, or report a conflict.

type State = { notes: string };
type Order = { version: number; notes: string };

class FakeServer {
  version: number | null = null; // null = the order does not exist yet
  notes = "";
  applied = new Map<string, number>(); // request id -> version it produced
  calls: SaveRequest<State>[] = [];
  /** What to do with the next calls, consumed in order. */
  script: Array<"ok" | "lose-response" | "fail-5xx" | "fail-400" | "conflict" | "hang"> = [];
  private hangResolvers: Array<() => void> = [];
  conflictOrder: Order = { version: 99, notes: "from another tab" };

  async send(request: SaveRequest<State>): Promise<SaveOutcome<Order>> {
    this.calls.push(request);
    const step = this.script.shift() ?? "ok";
    if (step === "hang") await new Promise<void>((resolve) => this.hangResolvers.push(resolve));
    if (step === "fail-5xx") return { kind: "retryable", message: "Server error" };
    if (step === "fail-400") return { kind: "fatal", message: "Invalid input" };
    if (step === "conflict") return { kind: "conflict", current: this.conflictOrder };

    // Replay: the same request id returns the version it already produced and changes nothing.
    const already = this.applied.get(request.requestId);
    if (already === undefined) {
      const expected = request.expectedVersion;
      if (expected !== this.version) return { kind: "conflict", current: { version: this.version ?? 0, notes: this.notes } };
      this.version = (this.version ?? 0) + 1;
      this.notes = request.state.notes;
      this.applied.set(request.requestId, this.version);
    }
    if (step === "lose-response") return { kind: "retryable", message: "Can't reach the server." };
    const version = this.applied.get(request.requestId)!;
    return { kind: "ok", version, savedAt: `saved-${version}`, order: { version, notes: this.notes } };
  }

  releaseHung() {
    for (const resolve of this.hangResolvers.splice(0)) resolve();
  }
}

let server: FakeServer;
let counter: number;

function setup(initial: { state: State; version: number | null } = { state: { notes: "" }, version: null }, options: Record<string, unknown> = {}) {
  server.version = initial.version;
  const machine = createAutosave<State, Order>(
    {
      send: (request) => server.send(request),
      newId: () => `req-${++counter}`,
      debounceMs: 800,
      maxAttempts: 3,
      backoffMs: () => 1000,
      ...options,
    },
    initial,
  );
  return machine;
}

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  counter = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("debounce and coalescing", () => {
  it("sends one request for several edits made within the delay, with expected_version null for the first save", async () => {
    const machine = setup();
    machine.edit({ notes: "a" });
    await vi.advanceTimersByTimeAsync(300);
    machine.edit({ notes: "ab" });
    await vi.advanceTimersByTimeAsync(300);
    machine.edit({ notes: "abc" });
    expect(server.calls).toHaveLength(0);
    expect(machine.getSnapshot().isDirty).toBe(true);

    await vi.advanceTimersByTimeAsync(800);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ requestId: "req-1", expectedVersion: null, state: { notes: "abc" } });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false, version: 1, lastSavedAt: "saved-1" });
  });

  it("makes no request when an edit leaves the state unchanged", async () => {
    const machine = setup({ state: { notes: "same" }, version: 3 });
    machine.edit({ notes: "same" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls).toHaveLength(0);
    expect(machine.getSnapshot().isDirty).toBe(false);
  });

  it("is not dirty again when an edit is reverted before it was sent", async () => {
    const machine = setup({ state: { notes: "x" }, version: 2 });
    machine.edit({ notes: "y" });
    machine.edit({ notes: "x" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls).toHaveLength(0);
    expect(machine.getSnapshot().isDirty).toBe(false);
  });

  it("starts idle and clean when an existing order is opened", () => {
    const machine = setup({ state: { notes: "x" }, version: 2 }, {});
    expect(machine.getSnapshot()).toMatchObject({ status: "idle", isDirty: false, version: 2 });
  });
});

describe("one request in flight", () => {
  it("sends an edit made during a request afterwards, with the returned version and a new request id", async () => {
    server.script = ["hang"];
    const machine = setup();
    machine.edit({ notes: "one" });
    await vi.advanceTimersByTimeAsync(800);
    expect(server.calls).toHaveLength(1);
    expect(machine.getSnapshot().status).toBe("saving");

    machine.edit({ notes: "two" }); // while the first request is still in flight
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls).toHaveLength(1); // still only one request at a time

    server.releaseHung();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toMatchObject({ requestId: "req-2", expectedVersion: 1, state: { notes: "two" } });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false, version: 2 });
    expect(server.notes).toBe("two");
  });
});

describe("failures and retries", () => {
  it("retries a server error with the SAME request id and payload, then succeeds", async () => {
    server.script = ["fail-5xx", "ok"];
    const machine = setup();
    machine.edit({ notes: "a" });
    await vi.advanceTimersByTimeAsync(800);
    expect(machine.getSnapshot().status).toBe("saving");
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].requestId).toBe(server.calls[0].requestId);
    expect(server.calls[1].state).toEqual(server.calls[0].state);
    expect(machine.getSnapshot().status).toBe("saved");
  });

  it("gives up after the attempts, shows Not saved, keeps the edit, and Retry resends the same request", async () => {
    server.script = ["fail-5xx", "fail-5xx", "fail-5xx"];
    const machine = setup();
    machine.edit({ notes: "keep me" });
    await vi.advanceTimersByTimeAsync(800 + 1000 + 1000);
    expect(server.calls).toHaveLength(3);
    expect(machine.getSnapshot()).toMatchObject({ status: "not_saved", isDirty: true, error: "Server error" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(3); // no endless loop

    machine.retry();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.calls).toHaveLength(4);
    expect(server.calls[3].requestId).toBe(server.calls[0].requestId);
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false });
    expect(server.notes).toBe("keep me");
  });

  it("creates exactly one order and one set of changes when a response is lost and the request is retried", async () => {
    server.script = ["lose-response", "ok"];
    const machine = setup();
    machine.edit({ notes: "once" });
    await vi.advanceTimersByTimeAsync(800 + 1000);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[0].requestId).toBe(server.calls[1].requestId);
    expect(server.version).toBe(1); // applied once, not twice
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", version: 1, isDirty: false });
  });

  it("makes an edit wait for a request that is being retried, then sends it with the returned version (no false conflict)", async () => {
    server.script = ["lose-response", "ok", "ok"];
    const machine = setup();
    machine.edit({ notes: "first" });
    await vi.advanceTimersByTimeAsync(800); // first request sent; its response is lost
    expect(machine.getSnapshot().status).toBe("saving");

    machine.edit({ notes: "second" }); // typed while the first is being retried
    await vi.advanceTimersByTimeAsync(800 + 10);
    expect(server.calls[1].requestId).toBe(server.calls[0].requestId); // the first request is retried FIRST, as itself
    await vi.advanceTimersByTimeAsync(10);

    const last = server.calls[server.calls.length - 1];
    expect(last.state.notes).toBe("second");
    expect(last.expectedVersion).toBe(1);
    expect(last.requestId).not.toBe(server.calls[0].requestId);
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false, version: 2 });
    expect(server.notes).toBe("second");
  });

  it("does not retry a 400-type rejection: it stops with the message, and the next edit makes a new request", async () => {
    server.script = ["fail-400", "ok"];
    const machine = setup();
    machine.edit({ notes: "bad" });
    await vi.advanceTimersByTimeAsync(800);
    expect(machine.getSnapshot()).toMatchObject({ status: "not_saved", error: "Invalid input", isDirty: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(1);

    machine.edit({ notes: "fixed" });
    await vi.advanceTimersByTimeAsync(800);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].requestId).not.toBe(server.calls[0].requestId);
    expect(machine.getSnapshot().status).toBe("saved");
  });

  it("treats a thrown error from the transport as a retryable failure", async () => {
    let first = true;
    const machine = createAutosave<State, Order>(
      {
        send: async (request) => {
          if (first) {
            first = false;
            throw new Error("boom");
          }
          return server.send(request);
        },
        newId: () => `req-${++counter}`,
      },
      { state: { notes: "" }, version: null },
    );
    machine.edit({ notes: "x" });
    await vi.advanceTimersByTimeAsync(800 + 1000 + 10);
    expect(machine.getSnapshot().status).toBe("saved");
  });
});

describe("conflict", () => {
  it("stops saving, keeps the local edits and exposes the server's order; adopting it resumes", async () => {
    server.script = ["conflict"];
    const machine = setup({ state: { notes: "old" }, version: 1 });
    server.version = 5;
    machine.edit({ notes: "mine" });
    await vi.advanceTimersByTimeAsync(800);
    expect(machine.getSnapshot()).toMatchObject({ status: "changed_elsewhere", isDirty: true, conflict: { version: 99, notes: "from another tab" } });

    machine.edit({ notes: "mine, more" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.calls).toHaveLength(1); // autosave stays stopped
    expect(machine.getLocalState()).toEqual({ notes: "mine, more" });

    machine.adopt({ notes: "from another tab" }, 99, { version: 99, notes: "from another tab" });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false, version: 99, conflict: null });
    expect(machine.getLocalState()).toEqual({ notes: "from another tab" });
  });
});

describe("flush", () => {
  it("resolves at once when nothing is unsaved", async () => {
    const machine = setup({ state: { notes: "x" }, version: 2 });
    await expect(machine.flush()).resolves.toBeUndefined();
    expect(server.calls).toHaveLength(0);
  });

  it("saves an edit typed a moment ago without waiting for the delay, and resolves only after the server confirmed it", async () => {
    const machine = setup();
    machine.edit({ notes: "just typed" });
    let resolved = false;
    const done = machine.flush().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(resolved).toBe(true);
    expect(server.calls).toHaveLength(1);
    expect(server.notes).toBe("just typed");
    expect(machine.getSnapshot().isDirty).toBe(false);
  });

  it("waits for a request already in flight and for the edit made after it", async () => {
    server.script = ["hang"];
    const machine = setup();
    machine.edit({ notes: "one" });
    await vi.advanceTimersByTimeAsync(800);
    machine.edit({ notes: "two" });
    const done = machine.flush();
    server.releaseHung();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(server.notes).toBe("two");
    expect(machine.getSnapshot().isDirty).toBe(false);
  });

  it("rejects when the save fails for good, so a confirmation is never sent after a failed save", async () => {
    server.script = ["fail-400"];
    const machine = setup();
    machine.edit({ notes: "x" });
    const done = machine.flush();
    const caught = done.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await caught).toBe("Invalid input");
  });

  it("rejects when the order was changed elsewhere", async () => {
    server.script = ["conflict"];
    const machine = setup({ state: { notes: "old" }, version: 1 });
    machine.edit({ notes: "new" });
    const caught = machine.flush().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10);
    expect(await caught).toMatch(/changed elsewhere/i);
  });

  it("tries again when Not saved is showing, because the person is leaving or confirming", async () => {
    server.script = ["fail-5xx", "fail-5xx", "fail-5xx", "ok"];
    const machine = setup();
    machine.edit({ notes: "x" });
    await vi.advanceTimersByTimeAsync(800 + 2000);
    expect(machine.getSnapshot().status).toBe("not_saved");
    const done = machine.flush();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false });
  });
});

describe("snapshot and subscription", () => {
  it("notifies subscribers and gives a stable snapshot object between changes", async () => {
    const machine = setup();
    const listener = vi.fn();
    const unsubscribe = machine.subscribe(listener);
    const a = machine.getSnapshot();
    expect(machine.getSnapshot()).toBe(a);
    machine.edit({ notes: "x" });
    expect(listener).toHaveBeenCalled();
    expect(machine.getSnapshot()).not.toBe(a);
    unsubscribe();
    listener.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops everything after dispose", async () => {
    const machine = setup();
    machine.edit({ notes: "x" });
    machine.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.calls).toHaveLength(0);
  });

  it("keeps the order the server returned (for the order number and totals on screen)", async () => {
    const machine = setup();
    machine.edit({ notes: "x" });
    await vi.advanceTimersByTimeAsync(800);
    expect(machine.getSnapshot().serverOrder).toEqual({ version: 1, notes: "x" });
  });
});

describe("manual mode (editing a confirmed order)", () => {
  it("never saves an edit on its own, and keeps the changes dirty until flush", async () => {
    const machine = setup({ state: { notes: "old" }, version: 4 }, { manual: true });
    machine.edit({ notes: "new" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(0);
    expect(machine.getSnapshot()).toMatchObject({ isDirty: true, status: "idle" });
  });

  it("saves everything as one request when flush is called, with the version it was opened at", async () => {
    server.version = 4;
    const machine = setup({ state: { notes: "old" }, version: 4 }, { manual: true });
    server.version = 4;
    machine.edit({ notes: "a" });
    machine.edit({ notes: "ab" });
    await machine.flush();
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ expectedVersion: 4, state: { notes: "ab" } });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false, version: 5 });
  });

  it("can discard its changes by adopting the saved state again", async () => {
    const machine = setup({ state: { notes: "old" }, version: 4 }, { manual: true });
    machine.edit({ notes: "changed" });
    machine.adopt({ notes: "old" }, 4, { version: 4, notes: "old" });
    expect(machine.getSnapshot()).toMatchObject({ isDirty: false });
    expect(machine.getLocalState()).toEqual({ notes: "old" });
  });
});
