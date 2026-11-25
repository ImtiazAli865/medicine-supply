import type { LeaderElection } from "@/lib/device/locks";
import type { PaymentSendResult } from "@/lib/device/payments";
import type { PaymentOpRecord } from "@/lib/device/schema";

// Shared fakes of the payment sending tests (Module 011): a sending-role election that a test can move, and the server side of
// the ledger as the payment route behaves (one entry per key, a repeat of the same content is a replay, other content is refused).

export type Step = "ok" | "5xx" | "lose" | "not_found" | "request_reused" | "refused" | "401" | "hang";

export class FakeLeader implements LeaderElection {
  leader: boolean;
  private readonly listeners = new Set<(leader: boolean) => void>();
  constructor(leader = true) {
    this.leader = leader;
  }
  isLeader = () => this.leader;
  subscribe = (l: (leader: boolean) => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  stop = () => undefined;
  set(value: boolean) {
    this.leader = value;
    for (const l of [...this.listeners]) l(value);
  }
}

/** The server side of the ledger, as the payment route behaves: one entry per key, a repeat of the same content is a replay. */
export class FakeLedger {
  entries = new Map<string, { storeId: string; amount: string; date: string; reference: string | null }>();
  calls: Array<{ id: string; storeId: string; amount: string }> = [];
  script: Step[] = [];
  gate: Promise<void> | null = null;
  inFlight = 0;
  maxInFlight = 0;

  async send(op: PaymentOpRecord): Promise<PaymentSendResult> {
    this.calls.push({ id: op.paymentId, storeId: op.storeId, amount: op.amount });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      const step = this.script.shift() ?? "ok";
      if (step === "hang") return await new Promise<PaymentSendResult>(() => undefined);
      if (step === "5xx") return { kind: "retryable", message: "Server error" };
      if (step === "401") return { kind: "unauthorized" };
      if (step === "not_found") return { kind: "conflict", conflict: "not_found", message: "This store is not on the server." };
      if (step === "request_reused") return { kind: "conflict", conflict: "request_reused", message: "A payment with this key but other details already exists. Check the store's account." };
      if (step === "refused") return { kind: "conflict", conflict: "refused", message: "Choose a date up to today." };
      const same = this.entries.get(op.paymentId);
      const content = { storeId: op.storeId, amount: op.amount, date: op.date, reference: op.reference };
      if (same && JSON.stringify(same) !== JSON.stringify(content)) return { kind: "conflict", conflict: "request_reused", message: "A payment with this key but other details already exists. Check the store's account." };
      if (!same) this.entries.set(op.paymentId, content);
      if (step === "lose") throw new Error("the answer was lost");
      return { kind: "ok" };
    } finally {
      this.inFlight -= 1;
    }
  }
}

