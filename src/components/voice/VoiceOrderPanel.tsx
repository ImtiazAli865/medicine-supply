"use client";

import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ListeningBar } from "@/components/voice/ListeningBar";
import { VoiceFailure } from "@/components/voice/VoiceFailure";
import { VoicePreview, type ReadAgainOutcome } from "@/components/voice/VoicePreview";
import { Button } from "@/components/ui/Button";
import { Select, TextArea } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { ClientApiError } from "@/lib/api/client";
import { newId } from "@/lib/ids";
import { createVoiceDraft, postParse } from "@/lib/voice/client";
import { LANGUAGE_TAGS, VOICE_LANGUAGES, isVoiceLanguage, readLanguage, writeLanguage, type VoiceLanguage } from "@/lib/voice/language";
import { CONNECTION_NEEDED_MESSAGE } from "@/lib/voice/messages";
import { mergeCorrections, previewReducer, stateFromPreview, type PreviewAction, type PreviewState } from "@/lib/voice/preview-state";
import { describeUnusable, findUnusableLines } from "@/lib/voice/unusable";
import { clearSession, forgetBootSession, parseSession, readBootSession, saveSession, saveSpokenText, type VoiceSession } from "@/lib/voice/session";
import { BrowserSpeechProvider, SPEECH_ERROR_MESSAGES, UNSUPPORTED_MESSAGE, type SpeechErrorCode } from "@/lib/voice/speech";
import type { ParserKind } from "@/lib/voice/types";
import { VOICE_LIMITS } from "@/lib/voice/types";

const AUDIO_NOTE =
  "The browser's speech service may process your voice to turn it into text, and it needs a connection. This app does not record or keep audio.";

/**
 * "Speak the order" on the New order screen: the microphone, the language, the editable transcript, and then the
 * preview. Speech becomes text on the device (the browser's own recognition); the text is sent to the server, where the
 * AI only turns it into a draft list. Nothing is saved until the supplier confirms the preview. Every failure keeps what
 * was said and leaves manual entry open.
 */
export function VoiceOrderPanel({ onPreviewChange }: { onPreviewChange?: (open: boolean) => void }) {
  // The unsent transcript and preview of this tab are read once when the screen opens. The server render has none, so
  // the body is keyed by whether one exists and starts from it.
  const raw = useSyncExternalStore(subscribeNever, readBootSession, () => null);
  const initial = useMemo(() => parseSession(raw), [raw]);
  useEffect(() => forgetBootSession, []);
  return <VoiceOrderBody key={initial ? "restored" : "fresh"} initial={initial} onPreviewChange={onPreviewChange} />;
}

const subscribeNever = () => () => {};

function VoiceOrderBody({ initial, onPreviewChange }: { initial: VoiceSession | null; onPreviewChange?: (open: boolean) => void }) {
  const router = useRouter();
  const provider = useMemo(() => new BrowserSpeechProvider(), []);
  // Browser-only facts: unknown on the server (null), read from the browser afterwards.
  const supported = useSyncExternalStore(subscribeNever, () => provider.isSupported(), () => null);
  const storedLanguage = useSyncExternalStore(subscribeNever, readLanguage, () => "en" as VoiceLanguage);
  const [chosenLanguage, setChosenLanguage] = useState<VoiceLanguage | null>(null);
  const language = chosenLanguage ?? storedLanguage;
  const [transcript, setTranscript] = useState(initial?.transcript ?? "");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [listenError, setListenError] = useState<SpeechErrorCode | null>(null);
  const [languageNote, setLanguageNote] = useState<string | null>(null);
  const [parsing, setParsing] = useState<ParserKind | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(initial?.preview ?? null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastParser, setLastParser] = useState<ParserKind>("ai");

  const sessionRef = useRef(0);
  const baseRef = useRef("");
  const parsingRef = useRef(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    onPreviewChange?.(preview !== null);
  }, [preview, onPreviewChange]);

  // The unsent transcript and preview survive a refresh in this tab (never called saved; cleared on create or start over).
  useEffect(() => {
    if (supported === null) return;
    if (transcript === "" && preview === null) return;
    saveSession({ transcript, preview });
  }, [transcript, preview, supported]);

  function begin(lang: string, allowFallback: boolean) {
    const id = (sessionRef.current += 1);
    const tags = LANGUAGE_TAGS[language];
    provider.start({
      lang,
      onStart: () => {
        if (id === sessionRef.current) setListening(true);
      },
      onResult: ({ final, interim: partial }) => {
        if (id !== sessionRef.current) return;
        const base = baseRef.current;
        setTranscript(final === "" ? base : base === "" || base.endsWith(" ") ? `${base}${final}` : `${base} ${final}`);
        setInterim(partial);
      },
      onError: (code) => {
        if (id !== sessionRef.current) return;
        if (code === "language_not_supported" && allowFallback && tags.fallback && lang !== tags.fallback) {
          setLanguageNote("This browser does not support the first choice of English, so it is listening in a general English instead. Check the words.");
          begin(tags.fallback, false);
          return;
        }
        if (code !== "aborted") setListenError(code);
      },
      onEnd: () => {
        if (id !== sessionRef.current) return;
        setListening(false);
        setInterim("");
      },
    });
  }

  function startListening() {
    setListenError(null);
    setLanguageNote(null);
    setFailure(null);
    baseRef.current = transcript.trim();
    begin(LANGUAGE_TAGS[language].primary, true);
  }

  function stopListening() {
    provider.stop();
  }

  async function parse(kind: ParserKind) {
    if (parsingRef.current) return;
    const text = transcript.trim();
    if (text === "") {
      setFailure("Say or type the order first.");
      return;
    }
    parsingRef.current = true;
    setParsing(kind);
    setLastParser(kind);
    setFailure(null);
    setCreateError(null);
    try {
      const result = await postParse({ transcript: text, parser: kind });
      setPreview(stateFromPreview(result));
    } catch (error) {
      if (error instanceof ClientApiError) setFailure(error.code === "network" ? CONNECTION_NEEDED_MESSAGE : error.message);
      else setFailure("Something went wrong. Please try again.");
    } finally {
      parsingRef.current = false;
      setParsing(null);
    }
  }

  /**
   * Reads the changed text again from the preview. The preview in front of the supplier stays exactly as it is until the
   * new reading arrives, and stays if it fails. With keepCorrections the hand corrections are merged into the new
   * reading; without it the new reading replaces everything.
   */
  async function readAgain(text: string, kind: ParserKind, keepCorrections: boolean): Promise<ReadAgainOutcome> {
    if (parsingRef.current || creatingRef.current) return { error: "Please wait a moment and try again.", notice: null };
    const clean = text.trim();
    if (clean === "") return { error: "Say or type the order first.", notice: null };
    parsingRef.current = true;
    setParsing(kind);
    setLastParser(kind);
    setCreateError(null);
    try {
      const result = stateFromPreview(await postParse({ transcript: clean, parser: kind }));
      // The controls are disabled while the text is being read, so the preview cannot change during the request.
      let notice: string | null = null;
      if (preview && keepCorrections) {
        const merged = mergeCorrections(preview, result);
        setPreview(merged.state);
        if (merged.overLimit > 0) {
          notice = `${merged.overLimit} line${merged.overLimit === 1 ? "" : "s"} of the new reading could not be added because an order can have at most ${VOICE_LIMITS.lines} lines.`;
        }
      } else {
        setPreview(result);
      }
      setTranscript(clean);
      return { error: null, notice };
    } catch (error) {
      if (error instanceof ClientApiError) return { error: error.code === "network" ? CONNECTION_NEEDED_MESSAGE : error.message, notice: null };
      return { error: "Something went wrong. Please try again.", notice: null };
    } finally {
      parsingRef.current = false;
      setParsing(null);
    }
  }

  const dispatch = useCallback((action: PreviewAction) => {
    setPreview((current) => (current ? previewReducer(current, action) : current));
  }, []);

  async function create() {
    if (!preview || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const { order } = await createVoiceDraft(preview, transcript.trim());
      clearSession();
      router.replace(`/orders/${order.id}`);
    } catch (error) {
      // The ids stay the same, so a retry is the same request and cannot create a second order.
      let message = error instanceof ClientApiError ? (error.code === "network" ? CONNECTION_NEEDED_MESSAGE : error.message) : "Something went wrong. Please try again.";
      // A medicine that is no longer active is refused for the whole order; say which lines (FR-028).
      if (error instanceof ClientApiError && error.code === "validation_error" && error.fields?.lines && /inactive|not found/i.test(error.fields.lines)) {
        const lines = await findUnusableLines(preview).catch(() => []);
        if (lines.length > 0) message = describeUnusable(lines);
      }
      setCreateError(message);
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function startOver() {
    provider.abort();
    clearSession();
    setPreview(null);
    setTranscript("");
    setFailure(null);
    setCreateError(null);
    setListenError(null);
    setLanguageNote(null);
  }

  /** The words said stay readable on the manual order screen (this tab only), and the same store is used when known. */
  function takeByHand() {
    const storeId = preview?.store.storeId ?? null;
    const orderId = storeId ? newId() : null;
    saveSpokenText(transcript.trim(), orderId);
    setPreview(null);
    setFailure(null);
    if (storeId && orderId) router.push(`/orders/${orderId}?store=${storeId}`);
  }

  function changeLanguage(value: string) {
    if (!isVoiceLanguage(value)) return;
    setChosenLanguage(value);
    writeLanguage(value);
  }

  const busy = parsing !== null;
  const tooLong = transcript.length > VOICE_LIMITS.transcript;

  if (preview) {
    return (
      <VoicePreview
        state={preview}
        transcript={transcript}
        dispatch={dispatch}
        creating={creating}
        reading={parsing}
        createError={createError}
        onCreate={() => void create()}
        onReadAgain={readAgain}
        onStartOver={startOver}
        onByHand={takeByHand}
      />
    );
  }

  return (
    <section aria-labelledby="voice-panel-heading" className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="voice-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="voice-panel-heading" className="text-lg font-semibold">
          Speak the order
        </h2>
      </div>

      {supported === false ? (
        <Banner kind="warning">
          <span data-testid="voice-unsupported">{UNSUPPORTED_MESSAGE}</span>
        </Banner>
      ) : (
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Select id="voice-language" label="Language you will speak" value={language} onChange={(e) => changeLanguage(e.target.value)} disabled={listening} data-testid="voice-language">
            {VOICE_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button onClick={startListening} disabled={supported !== true || listening || busy} aria-label="Start listening" data-testid="voice-mic" className="min-h-14 min-w-14">
            <Mic size={24} aria-hidden="true" />
          </Button>
        </div>
      )}
      <p className="text-sm text-muted" data-testid="voice-audio-note">
        {AUDIO_NOTE}
      </p>

      {listening ? <ListeningBar interim={interim} onStop={stopListening} /> : null}

      {languageNote ? <Banner kind="info">{languageNote}</Banner> : null}
      {listenError && listenError !== "aborted" ? (
        <div className="space-y-2" data-testid="voice-listen-error">
          <Banner kind="warning">{SPEECH_ERROR_MESSAGES[listenError]}</Banner>
          {supported ? (
            <Button variant="secondary" onClick={startListening} disabled={listening || busy} data-testid="voice-listen-retry">
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      <TextArea
        id="voice-transcript"
        label="Order text"
        rows={4}
        dir="auto"
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        hint="You can type here, use the microphone on your phone keyboard, or edit what was heard. For example: Al Madina Medical: Panadol 20 strips, Brufen 10 strips."
        error={tooLong ? `Use at most ${VOICE_LIMITS.transcript.toLocaleString("en-US")} characters.` : undefined}
        data-testid="voice-transcript"
      />

      {failure ? (
        <VoiceFailure message={failure} busy={busy} onRetry={() => void parse(lastParser)} onSimpleReader={() => void parse("rules")} onByHand={takeByHand} />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void parse("ai")} loading={parsing === "ai"} disabled={busy || listening || tooLong || transcript.trim() === ""} data-testid="voice-parse">
          Understand the order
        </Button>
        {!failure ? (
          <Button variant="secondary" onClick={() => void parse("rules")} loading={parsing === "rules"} disabled={busy || listening || tooLong || transcript.trim() === ""} data-testid="voice-parse-rules">
            Use the simple reader
          </Button>
        ) : null}
      </div>
    </section>
  );
}
