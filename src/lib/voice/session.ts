import type { PreviewState } from "./preview-state";

// A per-tab convenience: the transcript and the preview the supplier is working on survive a refresh in the same tab.
// This is NOT an order and NOT offline storage: nothing exists on the server until "Create draft order", the screen
// never calls it "saved" or "synchronised", and it is cleared on creation, start over or discard. Every read and write
// is inside try/catch because storage can be blocked, and the screen works without it.

const SESSION_KEY = "voice-preview-v1";
const SPOKEN_KEY = "voice-spoken-text-v1";

export interface VoiceSession {
  version: 1;
  transcript: string;
  preview: PreviewState | null;
}

export function saveSession(session: Omit<VoiceSession, "version">): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, ...session }));
  } catch {
    // The screen still works; a refresh just starts again.
  }
}

/** Parses a stored session; anything that does not look right is ignored. */
export function parseSession(raw: string | null): VoiceSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<VoiceSession> | null;
    if (!value || value.version !== 1 || typeof value.transcript !== "string") return null;
    const preview = value.preview ?? null;
    if (preview !== null && (typeof preview !== "object" || !Array.isArray(preview.lines) || typeof preview.orderId !== "string")) return null;
    return { version: 1, transcript: value.transcript, preview };
  } catch {
    return null;
  }
}

export function loadSession(): VoiceSession | null {
  try {
    return parseSession(window.sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

// The stored session as it was when the screen opened. It is read once per visit (so a screen that restores it does not
// restart every time it saves) and forgotten when the screen closes, so coming back reads the tab's copy again.
let bootRaw: string | null | undefined;

export function readBootSession(): string | null {
  if (bootRaw === undefined) {
    try {
      bootRaw = window.sessionStorage.getItem(SESSION_KEY);
    } catch {
      bootRaw = null;
    }
  }
  return bootRaw;
}

export function forgetBootSession(): void {
  bootRaw = undefined;
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * "Take this order by hand": the words the supplier said, kept for this tab so the manual order screen can show them in
 * a read-only box. They belong to one manual order: the one the supplier opens next (its id is claimed by that screen).
 */
interface SpokenNote {
  text: string;
  orderId: string | null;
}

function readNote(): SpokenNote | null {
  try {
    const raw = window.sessionStorage.getItem(SPOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SpokenNote> | null;
    if (!value || typeof value.text !== "string" || value.text.trim() === "") return null;
    return { text: value.text, orderId: typeof value.orderId === "string" ? value.orderId : null };
  } catch {
    return null;
  }
}

export function saveSpokenText(text: string, orderId: string | null = null): void {
  try {
    window.sessionStorage.setItem(SPOKEN_KEY, JSON.stringify({ text, orderId }));
  } catch {
    // Nothing to do.
  }
}

/** The spoken text meant for this order: kept for it, or waiting to be claimed by the next manual order opened. */
export function readSpokenFor(orderId: string): string | null {
  const note = readNote();
  if (!note) return null;
  return note.orderId === null || note.orderId === orderId ? note.text : null;
}

/** Ties a waiting note to this order, so it is never shown on another order. */
export function claimSpokenText(orderId: string): void {
  const note = readNote();
  if (note && note.orderId === null) saveSpokenText(note.text, orderId);
}

export function clearSpokenText(): void {
  try {
    window.sessionStorage.removeItem(SPOKEN_KEY);
  } catch {
    // Nothing to do.
  }
}
