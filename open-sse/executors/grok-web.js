import { WebSessionExecutor } from "./webSessionBase.js";
import { ACCEPT_ENCODING } from "../utils/zstdCompat.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { stripCookieInputPrefix } from "../../src/shared/utils/cookieValue.js";

// Read after module initialization: registry entries can import executor helpers.
const GROK_CHAT_API = () => PROVIDERS["grok-web"].baseUrl;
const GROK_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const MODEL_MAP = {
  "grok-3": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3", isThinking: false },
  "grok-3-mini": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_MINI_THINKING", isThinking: true },
  "grok-3-thinking": { grokModel: "grok-3", modelMode: "MODEL_MODE_GROK_3_THINKING", isThinking: true },
  "grok-4": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4", isThinking: false },
  "grok-4-mini": { grokModel: "grok-4-mini", modelMode: "MODEL_MODE_GROK_4_MINI_THINKING", isThinking: true },
  "grok-4-thinking": { grokModel: "grok-4", modelMode: "MODEL_MODE_GROK_4_THINKING", isThinking: true },
  "grok-4-heavy": { grokModel: "grok-4", modelMode: "MODEL_MODE_HEAVY", isThinking: true },
  "grok-4.1-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-4.1-fast": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-4.1-expert": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_EXPERT", isThinking: true },
  "grok-4.1-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4.2": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20-beta": { grokModel: "grok-420", modelMode: "MODEL_MODE_GROK_420", isThinking: false }
};

/**
 * Build the Cookie header for grok.com from whatever the operator pasted: the bare
 * `sso` value, `sso=<value>`, or a full DevTools Cookie header (optionally with a
 * `Cookie:` prefix). A full header is forwarded as pasted, in order, because other
 * first-party cookies the browser sent with it stay the operator's own; it must
 * contain an `sso` pair with a value. Returns "" when no usable session is present,
 * which the executor turns into a local 401 before any request reaches grok.com.
 */
export function buildGrokCookieHeader(raw) {
  const value = stripCookieInputPrefix(isString(raw) ? raw : "");
  if (!value) return "";

  const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";

  // A pair is name=value with a cookie-shaped name. A value that starts with "=" is
  // base64 padding of a raw token ("tok=="), not a cookie pair.
  const entries = parts.map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return { name: "", value: "" };
    const name = part.slice(0, separator);
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { name: "", value: "" };
    return { name, value: part.slice(separator + 1) };
  });

  // An `sso` name with an empty or blank value is an empty session, not a token:
  // reject it instead of turning it into the meaningless "sso=sso=".
  const ssoEntries = entries.filter((entry) => entry.name === "sso");
  if (ssoEntries.some((entry) => !entry.value.trim() || /\s/.test(entry.value))) return "";

  // A header is a paste that carries at least one name=value pair with a real
  // value; anything else is a raw token to send as the sso value itself.
  const isHeader = entries.some((entry) => entry.name && entry.value && !entry.value.startsWith("=") && !/^\s/.test(entry.value));
  if (!isHeader) return `sso=${value}`;

  return ssoEntries.length ? parts.join("; ") : "";
}

function randomString(length, alphanumeric = false) {
  const chars = alphanumeric ? "abcdefghijklmnopqrstuvwxyz0123456789" : "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function generateStatsigId() {
  const msg = Math.random() < 0.5 ?
  `e:TypeError: Cannot read properties of null (reading 'children["${randomString(5, true)}"]')` :
  `e:TypeError: Cannot read properties of undefined (reading '${randomString(10)}')`;
  return btoa(msg);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (isString(msg.content)) {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    extracted.push({ role, text: content });
  }

  let lastUserIdx = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") {lastUserIdx = i;break;}
  }

  const parts = [];
  for (let i = 0; i < extracted.length; i++) {
    const { role, text } = extracted[i];
    parts.push(i === lastUserIdx ? text : `${role}: ${text}`);
  }
  return parts.join("\n\n");
}

async function cancelAndReleaseReader(reader) {
  let timer = null;
  try {
    const cancellation = Promise.resolve(reader.cancel()).catch(() => {});
    await Promise.race([
    cancellation,
    new Promise((resolve) => {timer = setTimeout(resolve, 250);})]
    );
  } catch {/* cancellation is best-effort */} finally
  {
    clearTimeout(timer);
    try {reader.releaseLock();} catch {/* already released */}
  }
}

async function* readGrokNdjsonEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {yield JSON.parse(line);} catch {/* skip */}
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining) {
      try {yield JSON.parse(remaining);} catch {/* skip */}
    }
  } finally {
    await cancelAndReleaseReader(reader);
  }
}

async function* extractContent(eventStream, isThinkingModel, signal) {
  let fingerprint = "";
  let responseId = "";
  let thinkOpened = false;

  for await (const event of readGrokNdjsonEvents(eventStream, signal)) {
    if (event.error) {
      yield { error: event.error.message || `Grok error: ${event.error.code}`, done: true };
      return;
    }
    const resp = event.result?.response;
    if (!resp) continue;

    if (resp.llmInfo?.modelHash && !fingerprint) fingerprint = resp.llmInfo.modelHash;
    if (resp.responseId) responseId = resp.responseId;

    if (resp.isThinking === true) thinkOpened = true;

    if (resp.modelResponse) {
      const mr = resp.modelResponse;
      const message = mr.message;
      const messageIsThinking = thinkOpened || resp.isThinking === true;
      if (message != null && !isString(message)) {
        yield { error: "Invalid Grok final message", done: true };
        return;
      }
      if (thinkOpened && isThinkingModel) {
        if (message) yield { thinking: message };
        thinkOpened = false;
      }
      if (message && !messageIsThinking) yield { fullMessage: message, fingerprint, responseId };
      if (mr.metadata?.llm_info?.modelHash) fingerprint = mr.metadata.llm_info.modelHash;
      continue;
    }

    if (resp.token != null) {
      if (resp.isThinking === true) {
        if (isThinkingModel) yield { thinking: resp.token, fingerprint, responseId };
      } else {
        yield { delta: resp.token, fingerprint, responseId };
      }
    }
  }
  yield { done: true, fingerprint, responseId };
}

function buildStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }]
        })));

        let fp = "";
        let emittedContent = false;
        for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
          if (chunk.fingerprint) fp = chunk.fingerprint;

          if (chunk.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }]
            })));
            break;
          }
          if (chunk.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { reasoning_content: chunk.thinking }, finish_reason: null, logprobs: null }]
            })));
            continue;
          }
          if (chunk.done) break;
          // OmniRoute open-sse/executors/grok-web.ts: accept a final-only
          // message, but do not repeat one already delivered as token chunks.
          const content = chunk.delta || (!emittedContent && chunk.fullMessage);
          if (content) {
            emittedContent = true;
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content }, finish_reason: null, logprobs: null }]
            })));
          }
        }

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
          choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }]
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }]
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        controller.close();
      }
    }
  });
}

async function buildNonStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal, prompt) {
  let fullContent = "";
  let fingerprint = "";
  const thinkingParts = [];

  for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
    if (chunk.fingerprint) fingerprint = chunk.fingerprint;
    if (chunk.error) {
      return new Response(JSON.stringify({
        error: { message: chunk.error, type: "upstream_error", code: "GROK_ERROR" }
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (chunk.thinking) {thinkingParts.push(chunk.thinking);continue;}
    if (chunk.done) break;
    if (chunk.fullMessage) fullContent = chunk.fullMessage;else
    if (chunk.delta) fullContent += chunk.delta;
  }

  const msg = { role: "assistant", content: fullContent };
  if (thinkingParts.length > 0) msg.reasoning_content = thinkingParts.join("\n");

  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: fingerprint || null,
    choices: [{ index: 0, message: msg, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GrokWebExecutor extends WebSessionExecutor {
  constructor() {
    super("grok-web", PROVIDERS["grok-web"], { observePatchedFetch: false });
  }

  // The base owns transport and quota settlement; Grok retains its NDJSON protocol.
  async runSession(input, transport) {
    const { model, body, stream, credentials, signal, log } = input;
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API(), headers: {}, transformedBody: body };
    }
    if (messages.some((message) => message == null)) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Messages must not contain null entries", type: "invalid_request" }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API(), headers: {}, transformedBody: body };
    }

    const modelInfo = MODEL_MAP[model];
    if (!modelInfo) log?.info?.("GROK-WEB", `Unmapped model ${model}, defaulting to grok-4.1-fast`);
    const { grokModel, modelMode, isThinking } = modelInfo || MODEL_MAP["grok-4.1-fast"];

    const message = parseOpenAIMessages(messages);
    if (!message.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API(), headers: {}, transformedBody: body };
    }

    const grokPayload = {
      temporary: true, modelName: grokModel, modelMode, message,
      fileAttachments: [], imageAttachments: [],
      disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
      returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
      forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
      isReasoning: false, disableTextFollowUps: false, disableMemory: true,
      forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
      deviceEnvInfo: {
        darkModeEnabled: false, devicePixelRatio: 2,
        screenWidth: 2056, screenHeight: 1329, viewportWidth: 2056, viewportHeight: 1083
      }
    };

    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const headers = {
      Accept: "*/*",
      "Accept-Encoding": ACCEPT_ENCODING,
      "Accept-Language": "en-US,en;q=0.9",
      Baggage: "sentry-environment=production,sentry-release=d6add6fb0460641fd482d767a335ef72b9b6abb8,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://grok.com",
      Pragma: "no-cache",
      Referer: "https://grok.com/",
      "Sec-Ch-Ua": '"Google Chrome";v="136", "Chromium";v="136", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": GROK_USER_AGENT,
      "x-statsig-id": generateStatsigId(),
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`
    };

    const cookie = buildGrokCookieHeader(credentials?.apiKey);
    if (!cookie) {
      // No usable sso session: a missing sso, a blank `sso=` value, or a header
      // without sso all fail locally, before any request reaches grok.com.
      const errResp = new Response(JSON.stringify({
        error: { message: "Grok auth failed — no sso cookie found. An empty sso= value is rejected. Paste the sso cookie value from grok.com, or a Cookie header that contains sso=.", type: "upstream_error", code: "HTTP_401" }
      }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API(), headers: {}, transformedBody: grokPayload };
    }
    headers["Cookie"] = cookie;

    log?.info?.("GROK-WEB", `Query to ${model} (grok=${grokModel}, mode=${modelMode}), len=${message.length}`);

    let response;
    const result = (reply) => {
      return { response: reply, url: GROK_CHAT_API(), headers, transformedBody: grokPayload };
    };
    try {
      response = await transport.sendBillable(GROK_CHAT_API(), {
        method: "POST", headers, body: JSON.stringify(grokPayload), signal
      });
    } catch (err) {
      if (isQuotaDispatchUnavailable(err) || signal?.aborted) throw err;
        log?.error?.("GROK-WEB", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Grok connection failed: ${err.message || String(err)}`, type: "upstream_error" }
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return result(errResp);
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Grok returned HTTP ${status}`;
      if (status === 401 || status === 403) errMsg = "Grok auth failed — SSO cookie may be expired. Re-paste your sso cookie value from grok.com.";else
      if (status === 429) errMsg = "Grok rate limited. Wait a moment and retry, or rotate cookies.";
      log?.warn?.("GROK-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` }
      }), { status, headers: { "Content-Type": "application/json" } });
      return result(errResp);
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Grok returned empty response body", type: "upstream_error" }
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return result(errResp);
    }

    const cid = `chatcmpl-grok-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, isThinking, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER }
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, isThinking, signal, message);
    }
    return result(finalResponse);
  }
}

export default GrokWebExecutor;
