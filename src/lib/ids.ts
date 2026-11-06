/**
 * Client-generated record id. Creating the id before the first save makes a retried or
 * double-tapped save idempotent: the server treats a repeated id for the same business as the
 * same record instead of creating a duplicate.
 */
export function newId(): string {
  const c = globalThis.crypto;
  // crypto.randomUUID() exists only in secure contexts (HTTPS or localhost). On a phone opening the app
  // over plain http (for example a PC on the same Wi-Fi) it is undefined, so build a version 4 UUID
  // from getRandomValues, which works everywhere.
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
