// A tiny fake of the Gemini `generateContent` endpoint for the browser tests (Module 008). It never contacts any real
// service. The app server is pointed at it with GEMINI_API_BASE_URL. It checks the placeholder key, records every request
// body (so a test can assert that only the instruction and the transcript were sent), and answers according to markers in
// the transcript:
//   [[429]]          HTTP 429 (rate limit)            [[500]]    HTTP 500
//   [[401]]          HTTP 401 (key refused)           [[404]]    HTTP 404 (model not found)
//   [[slow]]         answers after 20 seconds (longer than the 15-second limit)
//   [[invalid-json]] answers with text that is not JSON
//   [[wrong-shape]]  answers with JSON of the wrong shape
//   [[blocked]]      a blocked prompt (no candidates, promptFeedback.blockReason)
//   [[extra]]        adds an invented item and price fields to an otherwise normal answer
// Otherwise it turns a clear sentence into a draft list: "Store: item qty unit, item qty unit and item qty unit".
// Test endpoints: GET /__health, GET /__requests, DELETE /__requests.
import http from "node:http";

const PORT = Number(process.env.FAKE_GEMINI_PORT ?? 4010);
const EXPECTED_KEY = "test-key-sentinel-do-not-use";
const requests = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function answer(text) {
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] };
}

/** "Store: Panadol 20 strips, Brufen 10 box and Calpol 5 bottles" -> { store, items } */
function draftFrom(transcript) {
  const clean = transcript.replace(/\[\[[a-z0-9-]+\]\]/g, " ").replace(/\s+/g, " ").trim();
  let store = null;
  let rest = clean;
  const colon = clean.indexOf(":");
  if (colon > 0) {
    store = clean.slice(0, colon).trim() || null;
    rest = clean.slice(colon + 1);
  }
  const items = [];
  for (const part of rest.split(/,|;|\band\b|\baur\b/i)) {
    const text = part.trim().replace(/\.$/, "");
    if (!text) continue;
    const m = /^(.*?)\s+(\d+(?:\.\d+)?)(?:\s+([A-Za-z]+))?$/.exec(text);
    if (m) items.push({ name: m[1].trim(), quantity: Number(m[2]), unit: m[3] ?? null });
    else items.push({ name: text, quantity: null, unit: null });
  }
  return { store, items };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/__health") return send(res, 200, { ok: true });
  if (url.pathname === "/__requests") {
    if (req.method === "DELETE") {
      requests.length = 0;
      return send(res, 200, { cleared: true });
    }
    return send(res, 200, requests);
  }

  const generate = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(url.pathname);
  if (!generate || req.method !== "POST") return send(res, 404, { error: { code: 404, message: "not found", status: "NOT_FOUND" } });

  const raw = await readBody(req);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = {};
  }
  const key = req.headers["x-goog-api-key"];
  const transcript = body?.contents?.[0]?.parts?.[0]?.text ?? "";
  // The key itself is never recorded; only whether it was the expected placeholder.
  requests.push({ model: generate[1], keyOk: key === EXPECTED_KEY, keyInUrl: url.search.includes("key="), body });

  if (key !== EXPECTED_KEY || transcript.includes("[[401]]")) return send(res, 401, { error: { code: 401, message: "API key not valid.", status: "UNAUTHENTICATED" } });
  if (transcript.includes("[[404]]")) return send(res, 404, { error: { code: 404, message: "model not found", status: "NOT_FOUND" } });
  if (transcript.includes("[[429]]")) return send(res, 429, { error: { code: 429, message: "Resource has been exhausted.", status: "RESOURCE_EXHAUSTED" } });
  if (transcript.includes("[[500]]")) return send(res, 500, { error: { code: 500, message: "internal", status: "INTERNAL" } });
  if (transcript.includes("[[blocked]]")) return send(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
  if (transcript.includes("[[invalid-json]]")) return send(res, 200, answer("this is not json"));
  if (transcript.includes("[[wrong-shape]]")) return send(res, 200, answer(JSON.stringify({ store: "x", items: "nope" })));
  if (transcript.includes("[[slow]]")) {
    setTimeout(() => send(res, 200, answer(JSON.stringify(draftFrom(transcript)))), 20000);
    return;
  }

  const draft = draftFrom(transcript);
  if (transcript.includes("[[extra]]")) {
    draft.items = draft.items.map((item) => ({ ...item, price: "125.50", mrp: "130.00" }));
    draft.items.push({ name: "Invented Medicine", quantity: 99, unit: "strips", price: "1.00" });
  }
  return send(res, 200, answer(JSON.stringify(draft)));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake gemini listening on ${PORT}`);
});
