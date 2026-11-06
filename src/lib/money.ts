// Exact money arithmetic for PKR. Amounts travel as decimal strings ("125.50"); all arithmetic
// is done on integer paisa (1 PKR = 100 paisa). Floating-point math is never used on money.
// The largest storable amount is 9,999,999,999.99 (NUMERIC(12,2) limit), which stays far below
// Number.MAX_SAFE_INTEGER when expressed in paisa.

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** True when the text is a non-negative amount with at most two decimals. */
export function isValidMoney(text: string): boolean {
  return MONEY_PATTERN.test(text);
}

/** Parses "125.5" or "125.50" to integer paisa. Returns null when invalid. */
export function parseMoneyToPaisa(text: string): number | null {
  const trimmed = text.trim();
  if (!MONEY_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const paisa = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paisa) ? paisa : null;
}

/** Formats integer paisa to a canonical two-decimal string. May be negative (for example profit). */
export function paisaToMoney(paisa: number): string {
  if (!Number.isSafeInteger(paisa)) throw new RangeError("paisa must be a safe integer");
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Canonical two-decimal form of a valid money string, or null. "125.5" -> "125.50". */
export function canonicalMoney(text: string): string | null {
  const paisa = parseMoneyToPaisa(text);
  return paisa === null ? null : paisaToMoney(paisa);
}

/** a - b, exactly. Returns null when either side is missing or invalid. */
export function subtractMoney(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null || b == null) return null;
  const left = parseMoneyToPaisa(a);
  const right = parseMoneyToPaisa(b);
  if (left === null || right === null) return null;
  return paisaToMoney(left - right);
}

/** Compares two money strings. Returns null when either is missing or invalid. */
export function compareMoney(a: string | null | undefined, b: string | null | undefined): number | null {
  if (a == null || b == null) return null;
  const left = parseMoneyToPaisa(a);
  const right = parseMoneyToPaisa(b);
  if (left === null || right === null) return null;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Display text such as "PKR 1,250.50". Negative amounts keep their sign. */
export function formatPKR(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const negative = amount.startsWith("-");
  const raw = negative ? amount.slice(1) : amount;
  const paisa = parseMoneyToPaisa(raw);
  if (paisa === null) return "—";
  const [whole, fraction] = paisaToMoney(paisa).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}PKR ${grouped}.${fraction}`;
}
