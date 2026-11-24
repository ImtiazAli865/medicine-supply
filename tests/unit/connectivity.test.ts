import { describe, expect, it } from "vitest";
import { createConnectivity, type Scheduler } from "@/lib/device/connectivity";

class FakeScheduler implements Scheduler {
  now = 0;
  private nextId = 1;
  readonly timers = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(handle: unknown) {
    this.timers.delete(handle as number);
  }
  /** Runs every timer that falls due within `ms` milliseconds, in order. */
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.now = end;
  }
  get pending() {
    return this.timers.size;
  }
}

function setup(results: boolean[]) {
  const scheduler = new FakeScheduler();
  let calls = 0;
  const c = createConnectivity({ ping: async () => results[Math.min(calls++, results.length - 1)]!, scheduler });
  const seen: string[] = [];
  c.subscribe((s) => seen.push(s));
  return { c, scheduler, seen, calls: () => calls };
}

describe("connectivity", () => {
  it("starts online and goes offline only on a real failure", () => {
    const { c, seen } = setup([true]);
    expect(c.getState()).toBe("online");
    c.reportFailure();
    expect(c.getState()).toBe("offline");
    expect(seen).toEqual(["offline"]);
  });

  it("treats a Wi-Fi with no internet as offline: the browser saying online changes nothing until the ping answers", async () => {
    const { c } = setup([false]);
    c.reportFailure();
    c.browserOnline();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.getState()).toBe("offline");
  });

  it("recovers when the ping answers and stops probing", async () => {
    const { c, scheduler, calls } = setup([false, false, true]);
    c.reportFailure();
    expect(scheduler.pending).toBe(1);
    await scheduler.advance(2_000); // first probe fails
    await scheduler.advance(5_000); // second probe fails
    expect(c.getState()).toBe("offline");
    await scheduler.advance(15_000); // third probe succeeds
    expect(c.getState()).toBe("online");
    expect(scheduler.pending).toBe(0);
    expect(calls()).toBe(3);
  });

  it("probes with growing waits", async () => {
    const { c, scheduler, calls } = setup([false]);
    c.reportFailure();
    await scheduler.advance(1_999);
    expect(calls()).toBe(0);
    await scheduler.advance(1);
    expect(calls()).toBe(1);
    await scheduler.advance(4_999);
    expect(calls()).toBe(1);
    await scheduler.advance(1);
    expect(calls()).toBe(2);
  });

  it("does not probe while online", async () => {
    const { scheduler, calls } = setup([true]);
    await scheduler.advance(600_000);
    expect(calls()).toBe(0);
    expect(scheduler.pending).toBe(0);
  });

  it("goes online at once when any request succeeds and cancels the probe", () => {
    const { c, scheduler } = setup([false]);
    c.reportFailure();
    expect(scheduler.pending).toBe(1);
    c.reportSuccess();
    expect(c.getState()).toBe("online");
    expect(scheduler.pending).toBe(0);
  });

  it("probes at once when the browser says it is online", async () => {
    const { c, calls } = setup([true]);
    c.reportFailure();
    c.browserOnline();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls()).toBe(1);
    expect(c.getState()).toBe("online");
  });

  it("goes offline on the browser's offline event and keeps probing", async () => {
    const { c, scheduler } = setup([false]);
    c.browserOffline();
    expect(c.getState()).toBe("offline");
    expect(scheduler.pending).toBe(1);
  });

  it("treats a ping that throws as a failure", async () => {
    const scheduler = new FakeScheduler();
    const c = createConnectivity({
      ping: async () => {
        throw new Error("boom");
      },
      scheduler,
    });
    c.reportFailure();
    await scheduler.advance(2_000);
    expect(c.getState()).toBe("offline");
  });

  it("stops everything on stop()", async () => {
    const { c, scheduler } = setup([false]);
    c.reportFailure();
    c.stop();
    expect(scheduler.pending).toBe(0);
    c.reportSuccess();
    expect(c.getState()).toBe("offline");
  });
});
