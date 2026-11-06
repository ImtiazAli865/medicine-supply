/** Display form of an order number: ORD- plus at least four digits (a longer number is never cut). */
export function formatOrderNumber(orderNumber: number): string {
  return `ORD-${String(orderNumber).padStart(4, "0")}`;
}

/**
 * Reads the digits of an order-number search: "12", "#12", "ORD-0012" and "ord 12" are all order
 * numbers. Returns the digits as typed, or null when the text is not an order number (then it is a
 * store-name search).
 */
export function parseOrderSearch(text: string): string | null {
  const match = /^(?:ord[-\s]*|#)?\s*(\d+)$/i.exec(text.trim());
  return match ? match[1] : null;
}
