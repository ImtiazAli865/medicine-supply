import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type DurableSnapshot, type SaveOutcome, type SaveRequest } from "@/lib/orders/autosave";

// The journal option of the autosave machine (Module 009): every change is kept on the device before "on_device" is
// reported, an unresolved request is kept (with its id) before it is sent, and nothing is sent while canSend() is false.

type State = { notes: string };
type Order = { version: number; notes: string };

class FakeServer {
  version: number | null = null;
  notes = "";
  applied = new Map<string, number>();
  calls: SaveRequest<State>[] = [];
  script: Array<"ok" | "fail-5xx" | "fail-400" | "conflict" | "lose-response"> = [];
  conflictOrder: Order = { version: 9, notes: "from another tab" };

  async send(request: SaveRequest<State>): Promise<SaveOutcome<Order>> {
    this.calls.push(request);
    const step = this.script.shift() ?? "ok";
    if (step === "fail-5xx") return { kind: "retryable", message: "Server error" };
    if (step === "fail-400") return { kind: "fatal", message: "Invalid input" };
    if (step === "conflict") return { kind: "conflict", current: this.conflictOrder };
    const already = this.applied.get(request.requestId);
    if (already === undefined) {
      if (request.expectedVersion !== this.version) return { kind: "conflict", current: { version: this.version ?? 0, notes: this.notes } };
      this.version = (this.version ?? 0) + 1;
      this.notes = request.state.notes;
      this.applied.set(request.requestId, this.version);
    }
    if (step === "lose-response") return { kind: "retryable", message: "Can't reach the server." };
    const version = this.applied.get(request.requestId)!;
    return { kind: "ok", version, savedAt: `saved-${version}`, order: { version, notes: this.notes } };
  }
}

class FakeJournal {
  writes: DurableSnapshot<State, Order>[] = [];
  /** When set, the next write waits for release(). */
  hold = false;
  fail = false;
  private waiting: Array<() => void> = [];

  async write(snapshot: DurableSnapshot<State, Order>): Promise<void> {
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.fail) throw new Error("This phone could not keep the change.");
    this.writes.push(structuredClone(snapshot));
  }

  release() {
    for (const r of this.waiting.splice(0)) r();
  }

  get last() {
    return this.writes[this.writes.length - 1];
  }
}

let server: FakeServer;
let journal: FakeJournal;
let counter: number;
let canSend: boolean;

function setup(initial: { state: State; version: number | null; pending?: SaveRequest<State> | null; conflict?: Order | null } = { state: { notes: "" }, version: null }, withJournal = true) {
  server.version = initial.version;
  return createAutosave<State, Order>(
    {
      send: (request) => server.send(request),
      newId: () => `req-${++counter}`,
      debounceMs: 800,
      maxAttempts: 3,
      backoffMs: () => 1000,
      ...(withJournal ? { journal, canSend: () => canSend } : {}),
    },
    initial,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  journal = new FakeJournal();
  counter = 0;
  canSend = true;
});
afterEach(() => vi.useRealTimers());

describe("the journal is written before on_device is shown", () => {
  it("shows 'pending' until the journal write completes, then 'on_device' when nothing can be sent", async () => {
    canSend = false;
    journal.hold = true;
    const machine = setup();
    machine.edit({ notes: "kept" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(machine.getSnapshot().status).toBe("pending");
    expect(journal.writes).toHaveLength(0);
    journal.hold = false;
    journal.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(journal.last).toMatchObject({ state: { notes: "kept" }, pending: null, synced: false });
    expect(machine.getSnapshot()).toMatchObject({ status: "on_device", isDirty: true });
    expect(server.calls).toHaveLength(0);
  });

  it("never reports on_device when the journal write fails: it says not_saved with the reason", async () => {
    canSend = false;
    journal.fail = true;
    const machine = setup();
    machine.edit({ notes: "lost?" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(machine.getSnapshot()).toMatchObject({ status: "not_saved", error: "This phone could not keep the change." });
  });

  it("writes the unresolved request to the journal BEFORE it is sent", async () => {
    const machine = setup();
    journal.hold = true;
    machine.edit({ notes: "abc" });
    await vi.advanceTimersByTimeAsync(800);
    expect(server.calls).toHaveLength(0); // waiting for the journal write that holds the request
    journal.hold = false;
    journal.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(server.calls).toHaveLength(1);
    const withRequest = journal.writes.find((w) => w.pending !== null);
    expect(withRequest?.pending).toMatchObject({ requestId: "req-1", expectedVersion: null, state: { notes: "abc" } });
  });

  it("records the server's answer: version, no pending request, synced", async () => {
    const machine = setup();
    machine.edit({ notes: "abc" });
    await vi.advanceTimersByTimeAsync(900);
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false });
    expect(journal.last).toMatchObject({ version: 1, pending: null, synced: true, state: { notes: "abc" } });
  });

  it("still sends when only the journal fails and the server answers (online use is not blocked)", async () => {
    journal.fail = true;
    const machine = setup();
    machine.edit({ notes: "abc" });
    await vi.advanceTimersByTimeAsync(900);
    expect(server.calls).toHaveLength(1);
    expect(machine.getSnapshot().status).toBe("saved");
  });
});

describe("retries, restart and canSend", () => {
  it("goes to on_device when the retries are used up, keeps the request, and repeats it exactly on retry()", async () => {
    server.script = ["fail-5xx", "fail-5xx", "fail-5xx"];
    const machine = setup();
    machine.edit({ notes: "abc" });
    await vi.advanceTimersByTimeAsync(800 + 3 * 1000 + 50);
    expect(machine.getSnapshot()).toMatchObject({ status: "on_device", isDirty: true, error: "Server error" });
    expect(server.calls.map((c) => c.requestId)).toEqual(["req-1", "req-1", "req-1"]);
    expect(journal.last?.pending).toMatchObject({ requestId: "req-1", state: { notes: "abc" } });

    machine.retry();
    await vi.advanceTimersByTimeAsync(50);
    expect(server.calls).toHaveLength(4);
    expect(server.calls[3]).toMatchObject({ requestId: "req-1", expectedVersion: null, state: { notes: "abc" } });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false });
    expect(server.version).toBe(1); // applied once
  });

  it("repeats a recovered request with the same id and payload after a restart, and applies it once", async () => {
    // The server applied req-7 but the phone never saw the answer, then the app was restarted.
    server.applied.set("req-7", 1);
    server.notes = "abc";
    const recovered: SaveRequest<State> = { requestId: "req-7", expectedVersion: null, state: { notes: "abc" } };
    const machine = setup({ state: { notes: "abc" }, version: null, pending: recovered });
    server.version = 1; // set() above resets it; the server really holds version 1
    machine.retry();
    await vi.advanceTimersByTimeAsync(50);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ requestId: "req-7", expectedVersion: null });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", version: 1, isDirty: false });
    expect(server.version).toBe(1);
  });

  it("an edit made while a recovered request waits is sent after it, with the version it produced", async () => {
    const recovered: SaveRequest<State> = { requestId: "req-7", expectedVersion: null, state: { notes: "first" } };
    const machine = setup({ state: { notes: "first" }, version: null, pending: recovered });
    machine.edit({ notes: "first and more" });
    machine.retry();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.calls.map((c) => [c.requestId, c.expectedVersion, c.state.notes])).toEqual([
      ["req-7", null, "first"],
      ["req-1", 1, "first and more"],
    ]);
    expect(machine.getSnapshot().status).toBe("saved");
  });

  it("does not send while canSend() is false, and sends after it becomes true and retry() is called", async () => {
    canSend = false;
    const machine = setup();
    machine.edit({ notes: "offline work" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.calls).toHaveLength(0);
    expect(machine.getSnapshot().status).toBe("on_device");
    canSend = true;
    machine.retry();
    await vi.advanceTimersByTimeAsync(50);
    expect(server.calls).toHaveLength(1);
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", isDirty: false });
  });

  it("flush() rejects while the change is only on the device and resolves once the server confirmed it", async () => {
    canSend = false;
    const machine = setup();
    machine.edit({ notes: "x" });
    const rejected = machine.flush().then(
      () => "resolved",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(await rejected).toMatch(/saved on this phone only/i);
    canSend = true;
    const resolved = machine.flush();
    await vi.advanceTimersByTimeAsync(50);
    await expect(resolved).resolves.toBeUndefined();
  });

  it("without a journal a lost connection still ends in not_saved, exactly as before", async () => {
    server.script = ["fail-5xx", "fail-5xx", "fail-5xx"];
    const machine = setup({ state: { notes: "" }, version: null }, false);
    machine.edit({ notes: "abc" });
    await vi.advanceTimersByTimeAsync(800 + 3 * 1000 + 50);
    expect(machine.getSnapshot().status).toBe("not_saved");
  });
});

describe("conflicts with the journal", () => {
  it("keeps the phone version on a conflict, records the server order, and stops sending", async () => {
    server.script = ["conflict"];
    const machine = setup({ state: { notes: "base" }, version: 1 });
    machine.edit({ notes: "phone edit" });
    await vi.advanceTimersByTimeAsync(900);
    expect(machine.getSnapshot()).toMatchObject({ status: "changed_elsewhere", conflict: { version: 9 }, state: { notes: "phone edit" } });
    expect(journal.last).toMatchObject({ conflict: { version: 9 }, state: { notes: "phone edit" }, synced: false });
    machine.edit({ notes: "phone edit 2" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.calls).toHaveLength(1);
  });

  it("rebase() takes the server's version as the base and sends the phone version again with a new request", async () => {
    server.script = ["conflict"];
    const machine = setup({ state: { notes: "base" }, version: 1 });
    machine.edit({ notes: "phone edit" });
    await vi.advanceTimersByTimeAsync(900);
    server.version = 9;
    server.notes = "from another tab";
    machine.rebase({ notes: "from another tab" }, 9, { version: 9, notes: "from another tab" });
    await vi.advanceTimersByTimeAsync(900);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]).toMatchObject({ expectedVersion: 9, state: { notes: "phone edit" } });
    expect(machine.getSnapshot()).toMatchObject({ status: "saved", version: 10, conflict: null });
    expect(server.notes).toBe("phone edit");
  });
});
