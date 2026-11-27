import { describe, expect, it } from "vitest";
import { createAutosave } from "@/lib/orders/autosave";
import { disposeWhenGone } from "@/lib/orders/dispose-when-gone";

// An order screen without the phone's storage owns its save machine. React may run an effect, its cleanup and the effect
// again without leaving the screen (development Strict Mode, Fast Refresh): the machine must stay alive then, or every added
// medicine is silently ignored.

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function machine() {
  return createAutosave<{ lines: string[] }, null>(
    { send: async () => ({ kind: "saved", version: 1, order: null }) as never, newId: () => "id", manual: true },
    { state: { lines: [] }, version: null, savedAt: null, order: null },
  );
}

describe("disposeWhenGone", () => {
  it("keeps the save machine alive when the effect is cleaned up and run again at once", async () => {
    const hold = disposeWhenGone();
    const m = machine();
    const first = hold(() => m.dispose());
    first();
    hold(() => m.dispose());
    await tick();
    m.edit({ lines: ["panadol"] });
    expect(m.getSnapshot().state.lines).toEqual(["panadol"]);
  });

  it("disposes once when the screen is really gone", async () => {
    const hold = disposeWhenGone();
    let disposed = 0;
    const first = hold(() => (disposed += 1));
    first();
    const second = hold(() => (disposed += 1));
    await tick();
    expect(disposed).toBe(0);
    second();
    await tick();
    expect(disposed).toBe(1);
  });
});
