import WebSocket from "ws";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import {
  buildPrompt,
  buildWsUrl,
  redactWsUrl,
  resolveConnectionParams } from
"./copilot-m365-connection.js";
import {
  accumulateBotContent,
  buildChatInvocation,
  encodeFrame,
  extractFinalResultMessage,
  handshakeError,
  handshakeFrame,
  isCompletionFrame,
  keepaliveFrame,
  parseFrame,
  splitFrames } from
"./copilot-m365-frames.js";
import { isString } from "@/shared/utils/typeChecks.js";

let WebSocketCtor = WebSocket;

export function __setCopilotM365WebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  return () => {
    WebSocketCtor = previous;
  };
}

function makeSseChunk(model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-copilot-m365-${Date.now()}`,
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

function sseErrorResponse(error, status = 502) {
  const message = error?.message || error || "Microsoft 365 Copilot stream error";
  return jsonError(sanitizeErrorMessage(message), status);
}

export class CopilotM365WebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-m365-web", { id: "copilot-m365-web", baseUrl: "wss://substrate.office.com" });
  }

  async wsChat(input) {
    return new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let ws = null;
        let settled = false;
        let buffer = "";
        let previousText = "";
        let finalResultMessage = "";
        let handshakeComplete = false;
        let completionReceived = false;

        const cleanup = () => {
          clearTimeout(timeout);
          if (ws) {
            try {ws.close();} catch {/* ignore */}
            ws = null;
          }
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          if (!previousText && finalResultMessage) {
            controller.enqueue(encoder.encode(makeSseChunk(input.model, { content: finalResultMessage })));
          }
          controller.enqueue(encoder.encode(makeSseChunk(input.model, {}, "stop")));
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

        input.signal?.addEventListener("abort", () => abort("Request aborted"), { once: true });
        let timeout = setTimeout(() => abort("Microsoft 365 Copilot WebSocket timeout"), FETCH_CONNECT_TIMEOUT_MS);

        const resetStallTimer = () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => abort("Microsoft 365 Copilot WebSocket stall timeout"), FETCH_CONNECT_TIMEOUT_MS);
        };

        try {
          const wsUrlParts = new URL(input.wsUrl);
          const traceId = wsUrlParts.searchParams.get("clientrequestid") ?? crypto.randomUUID().replace(/-/g, "");
          const sessionId = wsUrlParts.searchParams.get("X-SessionId") ?? crypto.randomUUID();

          ws = new WebSocketCtor(input.wsUrl, {
            headers: {
              Origin: "https://m365.cloud.microsoft",
              "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            }
          });

          const sendChat = () => {
            ws?.send(keepaliveFrame());
            ws?.send(encodeFrame(buildChatInvocation({
              text: input.prompt,
              traceId,
              sessionId,
              isStartOfSession: true
            })));
          };

          ws.on("open", () => ws?.send(handshakeFrame()));
          ws.on("message", (data) => {
            if (settled) return;
            buffer += data.toString();
            const split = splitFrames(buffer);
            buffer = split.rest;

            for (const rawFrame of split.frames) {
              const frame = parseFrame(rawFrame);
              if (!handshakeComplete) {
                const error = handshakeError(frame);
                if (error) {
                  clearTimeout(timeout);
                  abort(`Microsoft 365 Copilot handshake failed: ${error}`);
                  return;
                }
                handshakeComplete = true;
                resetStallTimer();
                sendChat();
                continue;
              }

              const { delta, next } = accumulateBotContent(previousText, frame);
              previousText = next;
              if (delta) {
                resetStallTimer();
                controller.enqueue(encoder.encode(makeSseChunk(input.model, { content: delta })));
              }

              const finalMessage = extractFinalResultMessage(frame);
              if (finalMessage) finalResultMessage = finalMessage;

              if (isCompletionFrame(frame)) {
                if (frame.error) {
                  clearTimeout(timeout);
                  abort(`Microsoft 365 Copilot completion error: ${frame.error}`);
                  return;
                }
                completionReceived = true;
                clearTimeout(timeout);
                finish();
                return;
              }
            }
          });
          ws.on("error", (err) => {
            clearTimeout(timeout);
            abort(err instanceof Error ? err.message : "Microsoft 365 Copilot WebSocket error");
          });
          ws.on("close", () => {
            clearTimeout(timeout);
            if (settled) return;
            if (completionReceived) finish();else
            abort(handshakeComplete ?
            "Microsoft 365 Copilot WebSocket closed before completion" :
            "Microsoft 365 Copilot WebSocket closed before handshake");
          });
        } catch (err) {
          clearTimeout(timeout);
          abort(err instanceof Error ? err.message : "Failed to connect to Microsoft 365 Copilot");
        }
      }
    }, { highWaterMark: 16384 });
  }

  async execute(input) {
    const body = input.body || {};
    const model = input.model || body.model || "copilot-m365";
    const stream = input.stream !== false;
    const prompt = buildPrompt(body).trim();

    if (!prompt) {
      return {
        response: jsonError("No user message provided", 400),
        url: "wss://substrate.office.com/m365Copilot/Chathub",
        headers: {},
        transformedBody: null
      };
    }

    const connectionParams = resolveConnectionParams(input.credentials);
    if ("error" in connectionParams) {
      return {
        response: jsonError(connectionParams.error, 400),
        url: "wss://substrate.office.com/m365Copilot/Chathub",
        headers: {},
        transformedBody: { model, prompt: prompt.slice(0, 100) }
      };
    }

    const wsUrl = buildWsUrl(connectionParams);
    const wsStream = await this.wsChat({ wsUrl, prompt, model, signal: input.signal });

    if (stream) {
      return {
        response: new Response(wsStream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
        }),
        url: redactWsUrl(wsUrl),
        headers: {},
        transformedBody: { model, prompt: prompt.slice(0, 100) }
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
              url: redactWsUrl(wsUrl),
              headers: {},
              transformedBody: { model, prompt: prompt.slice(0, 100) }
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
        id: `chatcmpl-copilot-m365-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: fullText || "(empty response)" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      }), { headers: { "Content-Type": "application/json" } }),
      url: redactWsUrl(wsUrl),
      headers: {},
      transformedBody: { model, prompt: prompt.slice(0, 100) }
    };
  }
}