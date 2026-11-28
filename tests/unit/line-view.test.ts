import { describe, expect, it } from "vitest";
import { LATEST_SHOWN, newestFirst } from "@/lib/orders/line-view";

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` }));
const visible = (view: ReturnType<typeof newestFirst>) => view.rows.filter((r) => !r.hidden).map((r) => r.line.id);
const none = new Set<string>();

describe("how a draft's lines are shown", () => {
  it("puts the newest line on top and keeps each line's place in the saved order", () => {
    const view = newestFirst(lines(3), false, none);
    expect(view.rows.map((r) => r.line.id)).toEqual(["l2", "l1", "l0"]);
    expect(view.rows.map((r) => r.position)).toEqual([2, 1, 0]);
    expect(view.older).toBe(0);
  });

  it("opens only the latest three of a longer order and drops no line", () => {
    const view = newestFirst(lines(8), false, none);
    expect(LATEST_SHOWN).toBe(3);
    expect(view.rows).toHaveLength(8);
    expect(visible(view)).toEqual(["l7", "l6", "l5"]);
    expect(view.older).toBe(5);
  });

  it("opens every line when asked", () => {
    const view = newestFirst(lines(8), true, none);
    expect(visible(view)).toHaveLength(8);
    expect(view.older).toBe(5);
  });

  it("never hides a line that needs the person's attention", () => {
    const view = newestFirst(lines(8), false, new Set(["l1"]));
    expect(visible(view)).toEqual(["l7", "l6", "l5", "l1"]);
  });

  it("does not change the list it was given", () => {
    const given = lines(4);
    newestFirst(given, false, none);
    expect(given.map((l) => l.id)).toEqual(["l0", "l1", "l2", "l3"]);
  });
});
