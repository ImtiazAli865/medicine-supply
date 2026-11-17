import type { RawParse } from "./types";
import { VOICE_LIMITS } from "./types";

// "Use the simple reader": a rule-based parser for CLEAR sentences, the safety net when the AI is unavailable. It is
// not a second AI. It reads only digits, never number words; it never guesses a medicine, a quantity or a unit; a part
// it cannot read is returned as `unreadable` for the supplier to fix by hand. Pure function; no I/O.
//
// Reads:  "Store: name 20 unit, name 10 unit and name 5 unit"   (the store before a colon)
//         "Store, name 20 unit, name 10 unit"                   (a first part with no digit, when other parts have one)
//         "name 20 unit, name 10 unit"                          (no store)
// Parts are separated by commas, semicolons, line breaks and the words "and" and "aur".

const PART_SEPARATOR = /,|;|\n|\band\b|\baur\b/i;
const ITEM = /^(.+?)\s+(\d{1,6})(?:\s+([A-Za-z]+(?:\s[A-Za-z]+)?))?$/;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
}

export function parseWithRules(transcript: string): RawParse {
  const text = transcript.replace(/\r/g, "\n").trim();
  if (text === "") return { store: null, items: [], unreadable: [] };

  let store: string | null = null;
  let rest = text;
  const colon = text.indexOf(":");
  if (colon > 0) {
    store = clean(text.slice(0, colon)) || null;
    rest = text.slice(colon + 1);
  }

  let parts = rest
    .split(PART_SEPARATOR)
    .map(clean)
    .filter((part) => part !== "");

  // No colon: a first part with no digit is the store when at least one other part has a digit.
  if (colon <= 0 && parts.length >= 2 && !/\d/.test(parts[0]) && parts.slice(1).some((part) => /\d/.test(part))) {
    store = parts[0];
    parts = parts.slice(1);
  }

  const items: RawParse["items"] = [];
  const unreadable: string[] = [];
  for (const part of parts) {
    const numbers = part.match(/\d+/g) ?? [];
    const match = numbers.length === 1 ? ITEM.exec(part) : null;
    if (!match || items.length >= VOICE_LIMITS.lines) {
      unreadable.push(part);
      continue;
    }
    items.push({ name: clean(match[1]), quantity: Number(match[2]), unit: match[3] ? clean(match[3]) : null });
  }
  return { store, items, unreadable };
}

/** The rule-based reader as a text-to-order parser (the same shape as the AI parser's). */
export const ruleParser = {
  async parse(transcript: string) {
    return parseWithRules(transcript);
  },
};
