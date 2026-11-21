// Only one tab or window of the phone sends the waiting orders at a time (Module 009, plan D5). The tab that holds the Web
// Lock named after the business is the sender; the other tabs wait for the lock and take over when the sender's tab closes.
// Without the Web Locks API the tab is assumed to be the only one.

export interface LockManagerLike {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
}

export interface LeaderElection {
  isLeader(): boolean;
  /** Called with the new value whenever this tab becomes (or stops being) the sender. */
  subscribe(listener: (leader: boolean) => void): () => void;
  /** Gives the lock back (the tab is closing or the business changed). */
  stop(): void;
}

export function createLeaderElection(name: string, locks: LockManagerLike | undefined): LeaderElection {
  const listeners = new Set<(leader: boolean) => void>();
  let leader = false;
  let release: (() => void) | null = null;
  let stopped = false;

  function set(next: boolean) {
    if (leader === next) return;
    leader = next;
    for (const l of Array.from(listeners)) l(leader);
  }

  if (!locks) {
    leader = true;
  } else {
    void locks
      .request(name, () => {
        if (stopped) return Promise.resolve();
        set(true);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        // The lock could not be requested: carry on as the only tab rather than never sending.
        if (!stopped) set(true);
      });
  }

  return {
    isLeader: () => leader,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      stopped = true;
      release?.();
      release = null;
      set(false);
      listeners.clear();
    },
  };
}
