// How a draft's lines are shown on the order screen: the newest first, with only the latest few open, so a line just added
// is in view without scrolling past the usual medicines. Display only: the saved order keeps the order of adding.

export const LATEST_SHOWN = 3;

export interface LineView<L> {
  /** Every line, newest first. `position` is the line's place in the saved order. */
  rows: Array<{ line: L; position: number; hidden: boolean }>;
  /** How many lines are older than the latest few (what "Show all" is about). */
  older: number;
}

/** `keep` holds the lines that need the person's attention: they are never hidden. */
export function newestFirst<L extends { id: string }>(lines: readonly L[], showAll: boolean, keep: ReadonlySet<string>): LineView<L> {
  const rows = lines.map((line, position) => ({ line, position, hidden: !showAll && position < lines.length - LATEST_SHOWN && !keep.has(line.id) })).reverse();
  return { rows, older: Math.max(0, lines.length - LATEST_SHOWN) };
}
