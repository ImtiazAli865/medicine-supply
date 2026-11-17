// The plain-English message of every voice failure, in one place, so the server, the screens and the tests say the
// same thing. None of them names a key, a model, an upstream body or a stack.

export type VoiceFailureCode = "rate_limited" | "ai_busy" | "ai_timeout" | "ai_invalid" | "ai_unavailable" | "ai_not_configured";

export const VOICE_ERROR_MESSAGES: Record<VoiceFailureCode, string> = {
  rate_limited: "Too many voice requests. Wait a moment and try again.",
  ai_busy: "The voice service is busy. Try again in a moment.",
  ai_timeout: "The voice service took too long. Try again or use the simple reader.",
  ai_invalid: "The answer could not be understood. Try again or edit the text.",
  ai_unavailable: "The voice service could not be reached. Try again or use the simple reader.",
  ai_not_configured: "Voice understanding is not set up on the server. Use the simple reader or take the order by hand.",
};

/** Short safe sentences for the diagnostic log (kept under 200 characters; never a transcript or an upstream body). */
export const VOICE_DIAGNOSTIC_MESSAGES: Record<VoiceFailureCode, string> = {
  rate_limited: "The limit of AI parses per minute was reached.",
  ai_busy: "The voice service answered that it is busy (rate limit).",
  ai_timeout: "The voice service did not answer in time.",
  ai_invalid: "The voice service answer was blocked, unfinished or did not fit the expected shape.",
  ai_unavailable: "The voice service could not be reached or returned a server error.",
  ai_not_configured: "The server has no usable key or model for the voice service, or the service refused it.",
};

/** The message shown when the browser cannot reach the server at all. */
export const CONNECTION_NEEDED_MESSAGE = "A connection is needed to understand the order. Check the connection and try again, or take the order by hand.";
