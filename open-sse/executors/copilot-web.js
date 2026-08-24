/**
 * Microsoft Copilot Web executor.
 *
 * Ports the minimum OmniRoute browser WebSocket flow into the JS runtime:
 * start a Copilot conversation, send the OpenAI user prompt over the chat
 * socket, then expose provider frames as OpenAI-compatible SSE or JSON.
 */
import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import { isFunction, isNumber, isString } from "../../src/shared/utils/typeChecks.js";

async function proxyAgentForWebSocket(proxyUrl) {
  try {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    return new HttpsProxyAgent(proxyUrl);
  } catch {
    try {
      const { SocksProxyAgent } = await import("socks-proxy-agent");
      return new SocksProxyAgent(proxyUrl);
    } catch {
      return null;
    }
  }
}

const COPILOT_BASE = "https://copilot.microsoft.com";
const COPILOT_START_URL = `${COPILOT_BASE}/c/api/start`;
const COPILOT_WS_URL = "wss://copilot.microsoft.com/c/api/chat?api-version=2";
const COPILOT_USER_AGENT =
"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const MODEL_MODE_MAP = {
  copilot: "chat",
  "copilot-chat": "chat",
  "gpt-4o": "chat",
  "gpt-4": "chat",
  "copilot-think": "reasoning",
  "copilot-think-deeper": "reasoning",
  o1: "reasoning",
  o3: "reasoning",
  "copilot-smart": "smart",
  "copilot-gpt5": "smart",
  "gpt-5": "smart",
  "copilot-study": "chat"
};

let WebSocketCtorForTesting = null;

export function __setCopilotWebSocketForTesting(ctor) {
  const previous = WebSocketCtorForTesting;
  WebSocketCtorForTesting = ctor;
  return () => {
    WebSocketCtorForTesting = previous;
  };
}

export function getCopilotMode(model) {
  return model ? MODEL_MODE_MAP[String(model).toLowerCase()] || "chat" : "chat";
}

export function solveHashcash(parameter, difficulty) {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 8) return null;
  const prefix = "0".repeat(difficulty);
  for (let i = 0; i < 10_000_000; i++) {
    const hash = createHash("sha256").update(`${parameter}:${i}`).digest("hex");
    if (hash.startsWith(prefix)) return i;
  }
  return null;
}

/**
 * Solve upstream hashcash without monopolizing the Node event loop. Work is
 * time-bounded and yields between small batches so unrelated requests keep
 * progressing while a challenge is evaluated.
 */
export async function solveHashcashAsync(
parameter,
difficulty,
{ maxIterations = 10_000_000, maxDurationMs = 2_000, yieldEvery = 2_000 } = {})
{
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 8) return null;
  const prefix = "0".repeat(difficulty);
  const deadline = Date.now() + Math.max(1, maxDurationMs);
  for (let i = 0; i < maxIterations; i++) {
    const hash = createHash("sha256").update(`${parameter}:${i}`).digest("hex");
    if (hash.startsWith(prefix)) return i;
    if (i > 0 && i % yieldEvery === 0) {
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return null;
}

export function extractAccessToken(credential) {
  if (!credential) return null;
  const value = String(credential).trim();
  const cookieMatch = value.match(/access_token=([^;]+)/);
  if (cookieMatch) return cookieMatch[1];
  const bearerMatch = value.match(/[Bb]earer\s+(.+)/);
  if (bearerMatch) return bearerMatch[1];
  if (value.startsWith("ey") || value.length > 100) return value;
  return value;
}

export function sessionPoolKey(token) {
  return token && token.length > 0 ?
  createHash("sha256").update(String(token)).digest("hex") :
  "anonymous";
}

async function resolveWebSocketCtor() {
  if (WebSocketCtorForTesting) return WebSocketCtorForTesting;
  const imported = await import("ws");
  return imported.default || imported.WebSocket;
}

function makeSseChunk(model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-copilot-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`;
}

function jsonError(message, status = 502) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function messageContentText(content) {
  if (isString(content)) return content;
  if (Array.isArray(content)) {
    return content.
    map((part) => {
      if (isString(part)) return part;
      if (part?.type === "text" && isString(part.text)) return part.text;
      return JSON.stringify(part ?? "");
    }).
    filter(Boolean).
    join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

export function flattenPrompt(body) {
  const messages = body?.messages || [];
  const systemText = messages.
  filter((m) => m.role === "system" || m.role === "developer").
  map((m) => messageContentText(m.content)).
  filter(Boolean).
  join("\n");
  const turns = messages.
  filter((m) => m.role !== "system" && m.role !== "developer").
  map((m) => {
    const text = messageContentText(m.content).trim();
    if (!text) return "";
    const role = m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool" : "User";
    return `[${role}]\n${text}`;
  }).
  filter(Boolean).
  join("\n\n");
  return `${systemText ? `[System Instructions]\n${systemText}\n\n` : ""}${turns}`;
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Copilot session start timeout")), timeoutMs);
  const onAbort = () => controller.abort(parentSignal?.reason || new Error("Request aborted"));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();else
    parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.("abort", onAbort);
    }
  };
}

function sseErrorResponse(error, status = 502) {
  const message = error?.message || error || "Copilot stream error";
  return jsonError(sanitizeErrorMessage(message), status);
}

export class CopilotWebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-web", { id: "copilot-web", baseUrl: COPILOT_START_URL });
  }

  async getSession(accessToken, signal, proxyOptions = null) {
    // OpenAI-compatible chat calls are stateless unless the client supplies an
    // explicit session key, so each request starts a fresh upstream thread.
    return this.createSession(accessToken, signal, proxyOptions);
  }

  async createSession(accessToken, signal, proxyOptions = null) {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": COPILOT_USER_AGENT,
      Origin: COPILOT_BASE,
      Referer: `${COPILOT_BASE}/`
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const scopedSignal = timeoutSignal(signal, FETCH_CONNECT_TIMEOUT_MS);
    try {
      const response = await proxyAwareFetch(COPILOT_START_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          timeZone: "America/New_York",
          startNewConversation: true,
          teenSupportEnabled: false
        }),
        signal: scopedSignal.signal
      }, proxyOptions);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new Error(`Copilot /c/api/start failed (${response.status}): ${text.slice(0, 200)}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      const conversationId = data.currentConversationId || data.conversationId;
      if (!conversationId) throw new Error("Copilot /c/api/start returned no conversationId");

      const setCookies = isFunction(response.headers.getSetCookie) ?
      response.headers.getSetCookie() :
      [];
      return {
        conversationId,
        cookies: setCookies.map((cookie) => cookie.split(";")[0]).join("; "),
        remainingTurns: data.remainingTurns ?? 1000,
        isBlocked: data.isBlocked ?? false,
        createdAt: Date.now()
      };
    } finally {
      scopedSignal.cleanup();
    }
  }

  async wsChat({ conversationId, prompt, mode, model, accessToken, signal, stream = true, proxyOptions = null }) {
    const WebSocketCtor = await resolveWebSocketCtor();
    const wsUrl = `${COPILOT_WS_URL}&clientSessionId=${crypto.randomUUID()}`;

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let ws;
        let settled = false;
        let chatSent = false;
        let timeout;
        let doneReceived = false;
        let copilotText = "";

        const cleanup = () => {
          if (timeout) clearTimeout(timeout);
          if (ws) {
            try {ws.close();} catch {/* ignore */}
          }
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          controller.enqueue(encoder.encode(makeSseChunk(model, {}, "stop")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        };
        const abort = (reason) => {
          if (settled) return;
          settled = true;
          cleanup();
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ error: { message: sanitizeErrorMessage(reason) } })}\n\n`
          ));
          controller.close();
        };
        const sendChat = () => {
          if (chatSent) return;
          chatSent = true;
          ws.send(JSON.stringify({
            event: "send",
            conversationId,
            content: [{ type: "text", text: prompt }],
            mode
          }));
        };
        const resetStallTimer = () => {
          if (timeout) clearTimeout(timeout);
          if (!stream) {
            timeout = setTimeout(() => abort("Copilot WebSocket stall timeout"), FETCH_CONNECT_TIMEOUT_MS);
          }
        };

        signal?.addEventListener("abort", () => abort("Request aborted"), { once: true });
        try {
          const wsOptions = { headers: {} };
          if (accessToken) wsOptions.headers.Authorization = `Bearer ${accessToken}`;
          if (proxyOptions?.connectionProxyEnabled && proxyOptions?.connectionProxyUrl) {
            const agent = await proxyAgentForWebSocket(proxyOptions.connectionProxyUrl);
            if (agent) wsOptions.agent = agent;
          }
          ws = new WebSocketCtor(wsUrl, wsOptions);
          timeout = setTimeout(() => abort("Copilot WebSocket timeout"), FETCH_CONNECT_TIMEOUT_MS);

          const onOpen = () => {
            if (timeout) {
              clearTimeout(timeout);
              if (!stream) {
                timeout = setTimeout(() => abort("Copilot WebSocket first message timeout"), FETCH_CONNECT_TIMEOUT_MS);
              } else {
                timeout = null;
              }
            }
            sendChat();
          };
          const onMessage = async (message) => {
            if (settled) return;
            resetStallTimer();
            const raw = message?.data ?? message;
            try {
              const event = isString(raw) ? JSON.parse(raw) : JSON.parse(String(raw));
              if (event.event === "appendText" || event.event === "replaceText") {
                const text = event.text || "";
                let delta = "";
                if (event.event === "replaceText") {
                  if (text.startsWith(copilotText) && copilotText.length > 0) {
                    delta = text.slice(copilotText.length);
                  } else {
                    delta = text;
                  }
                  copilotText = text;
                } else {
                  delta = text;
                  copilotText += text;
                }
                if (delta) controller.enqueue(encoder.encode(makeSseChunk(model, { content: delta })));
              } else if (event.event === "chainOfThought") {
                if (event.text) controller.enqueue(encoder.encode(makeSseChunk(model, { reasoning_content: event.text })));
              } else if (event.event === "challenge") {
                if (event.method === "hashcash" && event.parameter) {
                  const [param, difficultyRaw = "1"] = String(event.parameter).split(":");
                  const solution = await solveHashcashAsync(param, parseInt(difficultyRaw, 10));
                  if (settled) return;
                  if (solution === null) {
                    abort("Copilot hashcash challenge exceeded the safe work limit. Use an authenticated access_token.");
                    return;
                  }
                  ws.send(JSON.stringify({
                    event: "challengeResponse",
                    token: String(solution),
                    method: "hashcash"
                  }));
                  chatSent = false;
                  sendChat();
                } else {
                  abort("Copilot challenge not supported. Use an authenticated access_token.");
                }
              } else if (event.event === "done") {
                doneReceived = true;
                finish();
              } else if (event.event === "error") {
                abort(event.error || "Copilot stream error");
              }
            } catch {

              // Ignore unparsable provider frames.
            }};
          const onError = (err) => abort(err?.message || "Copilot WebSocket error");
          const onClose = () => {
            if (!doneReceived) {
              abort("Copilot WebSocket closed before completion");
            } else {
              finish();
            }
          };

          if (isFunction(ws.on)) {
            ws.on("open", onOpen);
            ws.on("message", onMessage);
            ws.on("error", onError);
            ws.on("close", onClose);
          } else {
            ws.onopen = onOpen;
            ws.onmessage = onMessage;
            ws.onerror = onError;
            ws.onclose = onClose;
          }
        } catch (err) {
          abort(err instanceof Error ? err.message : "Failed to connect to Copilot");
        }
      }
    }, { highWaterMark: 16384 });
  }

  async execute(input) {
    const body = input.body || {};
    const model = input.model || body.model || "copilot";
    const mode = getCopilotMode(model);
    const stream = input.stream !== false;
    const rawCredential =
    input.credentials?.apiKey || input.credentials?.providerSpecificData?.cookie || "";
    const accessToken = extractAccessToken(rawCredential);
    const prompt = flattenPrompt(body).trim();

    if (!prompt) {
      return { response: jsonError("No user message provided", 400), url: COPILOT_START_URL, headers: {}, transformedBody: null };
    }

    let conversationId;
    try {
      const session = await this.getSession(accessToken || undefined, input.signal, input.proxyOptions);
      conversationId = session.conversationId;
    } catch (err) {
      const upstreamStatus = isNumber(err?.status) ? err.status : undefined;
      const status = upstreamStatus === 401 || upstreamStatus === 403 ? upstreamStatus : 502;
      return {
        response: jsonError(sanitizeErrorMessage(err instanceof Error ? err.message : "Failed to start Copilot conversation"), status),
        url: COPILOT_START_URL,
        headers: accessToken ? { Authorization: "[redacted]" } : {},
        transformedBody: { conversationId: null, mode, prompt: prompt.slice(0, 100) }
      };
    }

    const wsStream = await this.wsChat({
      conversationId,
      prompt,
      mode,
      model,
      accessToken: accessToken || undefined,
      signal: input.signal,
      stream,
      proxyOptions: input.proxyOptions
    });

    if (stream) {
      return {
        response: new Response(wsStream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
        }),
        url: COPILOT_WS_URL,
        headers: {},
        transformedBody: { conversationId, mode, prompt: prompt.slice(0, 100) }
      };
    }

    const reader = wsStream.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return {
              response: sseErrorResponse(parsed.error),
              url: COPILOT_WS_URL,
              headers: {},
              transformedBody: { conversationId, mode, prompt: prompt.slice(0, 100) }
            };
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (isString(content)) fullText += content;
        } catch {

          // Skip malformed SSE lines.
        }}
    }

    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-copilot-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: fullText || "(empty response)" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }), { headers: { "Content-Type": "application/json" } }),
      url: COPILOT_WS_URL,
      headers: {},
      transformedBody: { conversationId, mode, prompt: prompt.slice(0, 100) }
    };
  }
}