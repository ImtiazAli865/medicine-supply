// The language the supplier speaks: English or Urdu. The choice is a lightweight preference kept on the device in
// localStorage (never a data backend), always read and written inside try/catch because storage can be blocked.

export type VoiceLanguage = "en" | "ur";

export const VOICE_LANGUAGES: Array<{ value: VoiceLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu" },
];

/** The browser language tags tried for each choice. English falls back once to en-US when en-PK is not supported. */
export const LANGUAGE_TAGS: Record<VoiceLanguage, { primary: string; fallback: string | null }> = {
  en: { primary: "en-PK", fallback: "en-US" },
  ur: { primary: "ur-PK", fallback: null },
};

const STORAGE_KEY = "voice-language";

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === "en" || value === "ur";
}

/** The remembered language, or English when nothing valid is stored or storage cannot be read. */
export function readLanguage(): VoiceLanguage {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isVoiceLanguage(value) ? value : "en";
  } catch {
    return "en";
  }
}

export function writeLanguage(language: VoiceLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The preference is a convenience; the choice still applies to this visit.
  }
}
