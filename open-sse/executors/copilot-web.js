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
import { sanitizeErrorMessage } from "../utils/error.js";

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
  "copilot-study": "chat",
};

const sessionPool = new Map();
let sessionRotationCount = 0;
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

export function extractAccessToken(credential) {
  if (!credential) return null;
  const value = String(credential).trim();
  if (value.startsWith("ey") || value.length > 100) return value;
  const cookieMatch = value.match(/access_token=([^;]+)/);
  if (cookieMatch) return cookieMatch[1];
  const bearerMatch = value.match(/[Bb]earer\s+(.+)/);
  if (bearerMatch) return bearerMatch[1];
  return value;
}

export function sessionPoolKey(token) {
  return token && token.length > 0 ? token : "anonymous";
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
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function jsonError(message, status = 502) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function flattenPrompt(body) {
  const messages = body?.messages || [];
  const userMsg = messages.filter((m) => m.role === "user").pop();
  const systemMsgs = messages.filter((m) => m.role === "system");
  const userText = userMsg
    ? (typeof userMsg.content === "string" ? userMsg.content : JSON.stringify(userMsg.content ?? ""))
    : "";
  const systemText = systemMsgs
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n");
  return `${systemText ? `[System Instructions]\n${systemText}\n\n` : ""}${userText}`;
}

export class CopilotWebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-web", { id: "copilot-web", baseUrl: COPILOT_START_URL });
  }

  async getSession(accessToken, signal) {
    const poolKey = sessionPoolKey(accessToken);
    const existing = sessionPool.get(poolKey);
    if (
      existing &&
      !existing.isBlocked &&
      existing.remainingTurns > 5 &&
      Date.now() - existing.createdAt < 3_600_000
    ) {
      return existing;
    }

    if (sessionRotationCount >= 1000) sessionRotationCount = 0;
    const session = await this.createSession(accessToken, signal);
    if (sessionPool.size >= 100) sessionPool.delete(sessionPool.keys().next().value);
    sessionPool.set(poolKey, session);
    sessionRotationCount++;
    return session;
  }

  async createSession(accessToken, signal) {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": COPILOT_USER_AGENT,
      Origin: COPILOT_BASE,
      Referer: `${COPILOT_BASE}/`,
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(COPILOT_START_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        timeZone: "America/New_York",
        startNewConversation: true,
        teenSupportEnabled: false,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Copilot /c/api/start failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const conversationId = data.currentConversationId || data.conversationId;
    if (!conversationId) throw new Error("Copilot /c/api/start returned no conversationId");

    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
    return {
      conversationId,
      cookies: setCookies.map((cookie) => cookie.split(";")[0]).join("; "),
      remainingTurns: data.remainingTurns ?? 1000,
      isBlocked: data.isBlocked ?? false,
      createdAt: Date.now(),
    };
  }

  async wsChat({ conversationId, prompt, mode, model, accessToken, signal }) {
    const WebSocketCtor = await resolveWebSocketCtor();
    const wsUrl = `${COPILOT_WS_URL}&clientSessionId=${crypto.randomUUID()}`;

    return new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let ws;
        let settled = false;
        let chatSent = false;
        let timeout;

        const cleanup = () => {
          if (timeout) clearTimeout(timeout);
          if (ws) {
            try { ws.close(); } catch { /* ignore */ }
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
            `data: ${JSON.stringify({ error: { message: sanitizeErrorMessage(reason) } })}\n\n`,
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
            mode,
          }));
        };

        signal?.addEventListener("abort", () => abort("Request aborted"), { once: true });
        try {
          const options = accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined;
          ws = options ? new WebSocketCtor(wsUrl, options) : new WebSocketCtor(wsUrl);
          timeout = setTimeout(() => abort("Copilot WebSocket timeout"), FETCH_CONNECT_TIMEOUT_MS);

          const onOpen = () => sendChat();
          const onMessage = (message) => {
            if (settled) return;
            const raw = message?.data ?? message;
            try {
              const event = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
              if (event.event === "appendText" || event.event === "replaceText") {
                if (event.text) controller.enqueue(encoder.encode(makeSseChunk(model, { content: event.text })));
              } else if (event.event === "chainOfThought") {
                if (event.text) controller.enqueue(encoder.encode(makeSseChunk(model, { reasoning_content: event.text })));
              } else if (event.event === "challenge") {
                if (event.method === "hashcash" && event.parameter) {
                  const [param, difficultyRaw = "1"] = String(event.parameter).split(":");
                  const solution = solveHashcash(param, parseInt(difficultyRaw, 10));
                  ws.send(JSON.stringify({
                    event: "challengeResponse",
                    token: solution !== null ? String(solution) : "",
                    method: "hashcash",
                  }));
                  chatSent = false;
                  sendChat();
                } else {
                  abort("Copilot challenge not supported. Use an authenticated access_token.");
                }
              } else if (event.event === "done") {
                finish();
              } else if (event.event === "error") {
                abort(event.error || "Copilot stream error");
              }
            } catch {
              // Ignore unparsable provider frames.
            }
          };
          const onError = (err) => abort(err?.message || "Copilot WebSocket error");
          const onClose = () => finish();

          if (typeof ws.on === "function") {
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
      },
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
      const session = await this.getSession(accessToken || undefined, input.signal);
      conversationId = session.conversationId;
    } catch (err) {
      return {
        response: jsonError(sanitizeErrorMessage(err instanceof Error ? err.message : "Failed to start Copilot conversation")),
        url: COPILOT_START_URL,
        headers: accessToken ? { Authorization: `Bearer ${accessToken.slice(0, 20)}...` } : {},
        transformedBody: { conversationId: null, mode, prompt: prompt.slice(0, 100) },
      };
    }

    const wsStream = await this.wsChat({
      conversationId,
      prompt,
      mode,
      model,
      accessToken: accessToken || undefined,
      signal: input.signal,
    });

    if (stream) {
      return {
        response: new Response(wsStream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        }),
        url: COPILOT_WS_URL,
        headers: {},
        transformedBody: { conversationId, mode, prompt: prompt.slice(0, 100) },
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
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string") fullText += content;
        } catch {
          // Skip malformed SSE lines.
        }
      }
    }

    return {
      response: new Response(JSON.stringify({
        id: `chatcmpl-copilot-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: fullText || "(empty response)" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { headers: { "Content-Type": "application/json" } }),
      url: COPILOT_WS_URL,
      headers: {},
      transformedBody: { conversationId, mode, prompt: prompt.slice(0, 100) },
    };
  }
}
