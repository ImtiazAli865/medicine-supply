import { describe, expect, it } from "vitest";
import { createLeaderElection, type LockManagerLike } from "@/lib/device/locks";

/** A minimal Web Locks stand-in: one holder per name, the others wait in line. */
class FakeLocks implements LockManagerLike {
  private readonly queues = new Map<string, Array<() => void>>();
  private readonly held = new Set<string>();

  async request(name: string, callback: () => Promise<void>): Promise<void> {
    if (this.held.has(name)) {
      await new Promise<void>((resolve) => {
        const q = this.queues.get(name) ?? [];
        q.push(resolve);
        this.queues.set(name, q);
      });
    }
    this.held.add(name);
    try {
      await callback();
    } finally {
      this.held.delete(name);
      const next = this.queues.get(name)?.shift();
      next?.();
    }
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("leader election", () => {
  it("makes the first tab the sender and the second wait", async () => {
    const locks = new FakeLocks();
    const a = createLeaderElection("biz", locks);
    const b = createLeaderElection("biz", locks);
    await tick();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
  });

  it("hands over to the waiting tab when the sender closes, and tells the subscribers", async () => {
    const locks = new FakeLocks();
    const a = createLeaderElection("biz", locks);
    const b = createLeaderElection("biz", locks);
    const seen: boolean[] = [];
    b.subscribe((v) => seen.push(v));
    await tick();
    a.stop();
    await tick();
    expect(a.isLeader()).toBe(false);
    expect(b.isLeader()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it("gives different businesses different locks", async () => {
    const locks = new FakeLocks();
    const a = createLeaderElection("biz-a", locks);
    const b = createLeaderElection("biz-b", locks);
    await tick();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(true);
  });

  it("assumes a single tab without the Web Locks API", () => {
    expect(createLeaderElection("biz", undefined).isLeader()).toBe(true);
  });

  it("falls back to sending when the lock request fails", async () => {
    const failing: LockManagerLike = { request: () => Promise.reject(new Error("denied")) };
    const a = createLeaderElection("biz", failing);
    await tick();
    expect(a.isLeader()).toBe(true);
  });

  it("does not become the sender after it was stopped while waiting", async () => {
    const locks = new FakeLocks();
    const a = createLeaderElection("biz", locks);
    const b = createLeaderElection("biz", locks);
    await tick();
    b.stop();
    a.stop();
    await tick();
    expect(b.isLeader()).toBe(false);
  });
});
