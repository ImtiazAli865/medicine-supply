import path from "node:path";

// The word rules of the offline static guard (Module 009, narrowed in Module 011 on purpose, see
// specs/011-hardening-offline-payments/research.md D4).
//
//  - The words purchase price, MRP, cost, margin, profit, balance, invoice, snapshot_ and ledger are forbidden in EVERY device
//    source, including the payment files below.
//  - The word "payment" is forbidden everywhere on the device EXCEPT in the payment files below (waiting payments are device
//    data since Module 011). A new file that needs the word has to be added here, on purpose, and shows up in the diff.
//  - A few files only NAME these words (the shell lists the areas that need the internet; the backup file code lists the keys a
//    backup must never contain) and are exempt from every word, as in Module 009.

/** Normalised so it compares equal on every operating system. */
const n = (...parts: string[]) => path.normalize(path.join(...parts));

export const NAMES_ONLY: ReadonlySet<string> = new Set([
  n("src", "lib", "device", "shell-route.ts"),
  n("src", "lib", "backup", "file.ts"),
  n("src", "components", "offline", "BackupSection.tsx"),
]);

/** The only device files that may contain the word "payment" (waiting payments, their sending, their screens and the backup path). */
export const PAYMENT_FILES: ReadonlySet<string> = new Set([
  n("src", "lib", "device", "payments.ts"),
  n("src", "lib", "device", "payment-transport.ts"),
  n("src", "lib", "device", "schema.ts"),
  n("src", "lib", "device", "sync-center.ts"),
  n("src", "lib", "device", "runtime.ts"),
  n("src", "lib", "backup", "client.ts"),
  n("src", "lib", "backup", "preview.ts"),
  n("src", "lib", "backup", "apply.ts"),
  n("src", "components", "offline", "OfflinePaymentScreen.tsx"),
  n("src", "components", "offline", "DevicePaymentCard.tsx"),
  n("src", "components", "offline", "OfflineShell.tsx"),
  n("src", "components", "offline", "OfflineProvider.tsx"),
  n("src", "components", "offline", "SyncStatusSection.tsx"),
  n("src", "components", "offline", "ImportPreview.tsx"),
  n("src", "components", "offline", "ExportOffer.tsx"),
  n("src", "components", "offline", "useBackupExport.ts"),
]);

/** Forbidden everywhere on the device, payment files included. */
export const FORBIDDEN_EVERYWHERE = /purchase_price|\bmrp\b|\bcost\b|\bmargin\b|\bprofit\b|\bbalance\b|invoice|snapshot_|ledger/gi;

const PAYMENT_WORD = /payment/i;

/** The forbidden words found in the (comment-free) source of one device file; an empty list means the file is clean. */
export function forbiddenWordsIn(file: string, source: string): string[] {
  const normal = path.normalize(file);
  if (NAMES_ONLY.has(normal)) return [];
  const found = new Set<string>();
  for (const m of source.matchAll(FORBIDDEN_EVERYWHERE)) found.add(m[0].toLowerCase());
  if (!PAYMENT_FILES.has(normal) && PAYMENT_WORD.test(source)) found.add("payment");
  return [...found].sort();
}
