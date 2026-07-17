import { randomUUID } from "node:crypto";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * HEAD /v1/completions — explicit handler (kills ~6s hang on HEAD probes).
 */
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * Normalize an id from the chat core (`chatcmpl-*` or other) into the legacy
 * completions id namespace (`cmpl-*`).
 * @param {string|undefined} id
 * @returns {string}
 */
function toCompletionId(id) {
  const raw = id == null ? "" : String(id);
  if (raw.startsWith("cmpl-")) return raw;
  if (raw.startsWith("chatcmpl-")) return `cmpl-${raw.slice("chatcmpl-".length)}`;
  return `cmpl-${raw || randomUUID()}`;
}

/**
 * Map a successful non-streaming chat.completion body to legacy text_completion.
 * Only `choices[].message.content` is surfaced as `choices[].text`; finish_reason
 * and usage are preserved. Everything else (prompt, logprobs, echo) is out of scope.
 * @param {object} body
 * @returns {object}
 */
function toTextCompletion(body) {
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  return {
    id: toCompletionId(body?.id),
    object: "text_completion",
    created: body?.created ?? Math.floor(Date.now() / 1000),
    model: body?.model,
    choices: choices.map((choice, index) => ({
      text: choice?.message?.content ?? "",
      index: choice?.index ?? index,
      logprobs: null,
      finish_reason: choice?.finish_reason ?? null,
    })),
    ...(body?.usage ? { usage: body.usage } : {}),
  };
}

/**
 * Map a single chat.completion.chunk object to a text_completion chunk.
 * Only `delta.content` contributes to `choices[].text`; role/reasoning/tool
 * deltas are dropped by design for the legacy text surface.
 * @param {object} chunk
 * @returns {object}
 */
function toTextCompletionChunk(chunk) {
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
  const mapped = choices.map((choice, index) => {
    const delta = choice?.delta || {};
    const text = typeof delta.content === "string" ? delta.content : "";
    return {
      text,
      index: choice?.index ?? index,
      logprobs: null,
      finish_reason: choice?.finish_reason ?? null,
    };
  });
  return {
    id: toCompletionId(chunk?.id),
    object: "text_completion",
    created: chunk?.created ?? Math.floor(Date.now() / 1000),
    model: chunk?.model,
    choices: mapped,
    ...(chunk?.usage ? { usage: chunk.usage } : {}),
  };
}

/**
 * Build a TransformStream that rewrites chat.completion.chunk SSE frames into
 * text_completion frames. Buffers incomplete lines across chunks so a `data:`
 * frame split mid-line by the network still reassembles. `[DONE]` is passed
 * through untouched. Non-`data:` lines (comments, event: lines) are forwarded.
 * @returns {TransformStream<Uint8Array, Uint8Array>}
 */
function createCompletionStreamTransform() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  function transformLine(line) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return `${line}\n`;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return "data: [DONE]\n";
    try {
      const chunk = JSON.parse(payload);
      if (chunk && chunk.object === "chat.completion.chunk") {
        return `data: ${JSON.stringify(toTextCompletionChunk(chunk))}\n`;
      }
      return `data: ${payload}\n`;
    } catch {
      // Malformed upstream frame: forward verbatim rather than crash the stream.
      return `data: ${payload}\n`;
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        controller.enqueue(encoder.encode(transformLine(line)));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(transformLine(buffer)));
        buffer = "";
      }
    },
  });
}

/**
 * Copy headers from an upstream response into a fresh Headers object, dropping
 * `content-length` and `content-encoding` so a rewritten (re-sized) body is not
 * truncated or mis-decoded by the client.
 * @param {Headers} source
 * @returns {Headers}
 */
function cleanResponseHeaders(source) {
  const headers = new Headers(source);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return headers;
}

/**
 * Adapt a legacy /v1/completions request body into a chat-shaped request.
 * - `prompt` string → single user message.
 * - `prompt` array with 1 element → unwrap.
 * - `prompt` array with >1 elements → 400 (multiple prompts not supported).
 * All other fields (model, max_tokens, temperature, stop, stream, …) pass through.
 * @param {object} body
 * @returns {{ ok: true, chatBody: object } | { ok: false, message: string }}
 */
export function adaptLegacyBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Invalid JSON body" };
  }
  const { prompt } = body;
  if (typeof prompt !== "string" && !Array.isArray(prompt)) {
    return { ok: false, message: "Missing prompt" };
  }
  if (Array.isArray(prompt) && prompt.length > 1) {
    return { ok: false, message: "multiple prompts not supported" };
  }
  const promptText = Array.isArray(prompt) ? prompt[0] : prompt;
  if (typeof promptText !== "string") {
    return { ok: false, message: "Invalid prompt" };
  }
  const { prompt: _drop, ...rest } = body;
  return {
    ok: true,
    chatBody: {
      ...rest,
      messages: [{ role: "user", content: promptText }],
    },
  };
}

/**
 * Map a successful chat-core Response (JSON or SSE) into the legacy
 * text_completion wire format. Non-2xx responses are returned untouched.
 * @param {Response} response
 * @returns {Promise<Response>}
 */
export async function mapCompletionResponse(response) {
  if (!response.ok) return response;

  const contentType = response.headers.get("content-type") || "";
  const headers = cleanResponseHeaders(response.headers);

  if (contentType.includes("text/event-stream") && response.body) {
    const stream = response.body.pipeThrough(createCompletionStreamTransform());
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }
  const mapped = toTextCompletion(body);
  return new Response(JSON.stringify(mapped), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * POST /v1/completions — legacy OpenAI text completions endpoint, bridged to
 * the chat core. Provider-native /v1/completions is an explicit non-goal; this
 * is the documented router-level shim.
 * // ponytail: legacy shim over chat core; upgrade path = provider-native completions passthrough when a provider still serves it.
 */
export async function POST(request) {
  await ensureInitialized();

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const adapted = adaptLegacyBody(body);
  if (!adapted.ok) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, adapted.message);
  }

  // Build a fresh Request from primitives: `request` body was already consumed
  // by request.json() above, so new Request(request, …) would throw. Auth
  // headers, method, and abort signal are forwarded explicitly.
  const chatHeaders = new Headers(request.headers);
  chatHeaders.set("content-type", "application/json");
  chatHeaders.delete("content-length");
  const chatRequest = new Request(request.url, {
    method: request.method,
    headers: chatHeaders,
    body: JSON.stringify(adapted.chatBody),
    signal: request.signal,
  });

  const response = await handleChat(chatRequest);
  return mapCompletionResponse(response);
}
