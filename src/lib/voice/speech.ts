// Speech to text on the device. The screens use the `SpeechToTextProvider` interface only, so another provider (for
// example a cloud speech service) can be added later without changing them. The first and only implementation is the
// browser's own speech recognition. The app never records, stores or uploads audio: the browser's speech service may
// process it, and the screen says so. Support is detected at run time and stated honestly.

export type SpeechErrorCode =
  | "permission_denied"
  | "service_not_allowed"
  | "no_speech"
  | "no_microphone"
  | "network"
  | "language_not_supported"
  | "aborted"
  | "unknown";

/** The plain message of each listening problem (the screen adds Retry and the typed box). */
export const SPEECH_ERROR_MESSAGES: Record<Exclude<SpeechErrorCode, "aborted">, string> = {
  permission_denied: "The microphone is blocked. Allow the microphone for this site in the browser settings, or type the order.",
  service_not_allowed: "This browser does not allow speech recognition here. Use the keyboard microphone or type the order.",
  no_speech: "Nothing was heard. Tap the microphone and speak again, or type the order.",
  no_microphone: "No microphone was found. Check the microphone or type the order.",
  network: "Speech recognition needs a connection and could not reach its service. Check the connection or type the order.",
  language_not_supported: "This browser does not support listening in the chosen language. Choose another language or type the order.",
  unknown: "Listening stopped because of a problem. Try again or type the order.",
};

export const UNSUPPORTED_MESSAGE =
  "This browser cannot listen to speech. Use the microphone on your phone keyboard, or type the order in the box.";

/** Maps a browser error name to our code. */
export function mapSpeechError(name: string | undefined): SpeechErrorCode {
  switch (name) {
    case "not-allowed":
      return "permission_denied";
    case "service-not-allowed":
      return "service_not_allowed";
    case "no-speech":
      return "no_speech";
    case "audio-capture":
      return "no_microphone";
    case "network":
      return "network";
    case "language-not-supported":
      return "language_not_supported";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

export interface SpeechResultText {
  /** Everything final so far in this session (it never changes once final). */
  final: string;
  /** The words still being worked out (they may change). */
  interim: string;
}

export interface SpeechStartOptions {
  /** A browser language tag such as en-PK or ur-PK. */
  lang: string;
  onStart?: () => void;
  onResult: (text: SpeechResultText) => void;
  onError: (code: SpeechErrorCode) => void;
  onEnd: () => void;
}

export interface SpeechToTextProvider {
  isSupported(): boolean;
  start(options: SpeechStartOptions): void;
  stop(): void;
  abort(): void;
}

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function constructorOf(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The browser's built-in speech recognition. */
export class BrowserSpeechProvider implements SpeechToTextProvider {
  private recognition: Recognition | null = null;

  isSupported(): boolean {
    return constructorOf() !== null;
  }

  start(options: SpeechStartOptions): void {
    const Ctor = constructorOf();
    if (!Ctor) {
      options.onError("service_not_allowed");
      options.onEnd();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = options.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";

    recognition.onstart = () => options.onStart?.();
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += (finalText === "" || finalText.endsWith(" ") ? "" : " ") + text.trim();
        else interim += text;
      }
      options.onResult({ final: finalText, interim: interim.trim() });
    };
    recognition.onerror = (event) => options.onError(mapSpeechError(event.error));
    recognition.onend = () => {
      this.recognition = null;
      options.onEnd();
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.recognition = null;
      options.onError("unknown");
      options.onEnd();
    }
  }

  stop(): void {
    this.recognition?.stop();
  }

  abort(): void {
    this.recognition?.abort();
  }
}
