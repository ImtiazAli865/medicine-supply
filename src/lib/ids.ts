/**
 * Client-generated record id. Creating the id before the first save makes a retried or
 * double-tapped save idempotent: the server treats a repeated id for the same business as the
 * same record instead of creating a duplicate.
 */
export function newId(): string {
  return crypto.randomUUID();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
