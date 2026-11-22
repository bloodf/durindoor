import WebSocket from "ws";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { refreshProviderCredentials } from "../services/oauthCredentialManager.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import { resolveWebSocketProxyRoute } from "../utils/proxyFetch.js";
import {
  buildWsUrl,
  promptFromMessages,
  redactWsUrl,
  resolveConnectionParams } from
"./copilot-m365-connection.js";
import {
  accumulateBotContent,
  buildChatInvocation,
  encodeFrame,
  extractBotText,
  extractFinalResultMessage,
  handshakeError,
  handshakeFrame,
  isCompletionFrame,
  keepaliveFrame,
  parseFrame,
  splitFrames } from
"./copilot-m365-frames.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { webSocketAuthStatus } from "../utils/webSessionExpiry.js";
import { m365Conversations, m365ReplyFingerprint } from "./copilot-m365-conversations.js";
import { M365ImageResolver, uploadM365Image } from "./copilot-m365-images.js";
import { M365ExecutorError, m365ErrorResponse, m365Output } from "./copilot-m365-output.js";
import {
  M365_MAX_TEXT_LENGTH,
  buildM365ToolInstructions,
  clientPlugins,
  extractToolSpec,
  parseM365ToolOutput } from
"./copilot-m365-tools.js";

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
  const upstreamStatus = error?.status === 401 || error?.status === 403 ? error.status : status;
  return jsonError(sanitizeErrorMessage(message), upstreamStatus);
}

export class CopilotM365WebExecutor extends BaseExecutor {
  constructor() {
    super("copilot-m365-web", { id: "copilot-m365-web", baseUrl: "wss://substrate.office.com" });
  }

  /**
   * Native sign-in rows renew their own access token with their own refresh token (and tenant).
   * A pasted session has no refresh token and is never routed here.
   */
  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshProviderCredentials("copilot-m365-web", credentials, log, proxyOptions);
  }

  async wsChat(input) {
    return new ReadableStream({
      async start(controller) {
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
          const finalText = previousText || finalResultMessage;
          // A completed turn: the executor commits its conversation for continuation only now.
          input.onDone?.(finalText);
          if ((!input.stream || !previousText) && finalText) {
            controller.enqueue(encoder.encode(makeSseChunk(input.model, { content: finalText })));
          }
          controller.enqueue(encoder.encode(makeSseChunk(input.model, {}, "stop")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        };
        const abort = (reason, status) => {
          if (settled) return;
          settled = true;
          cleanup();
          const envelope = { message: sanitizeErrorMessage(reason) };
          if (status) envelope.status = status;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: envelope })}\n\n`));
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

          const wsOptions = {
            headers: {
              Origin: "https://m365.cloud.microsoft",
              "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            }
          };
          const proxyRoute = resolveWebSocketProxyRoute(input.wsUrl, input.proxyOptions);
          if (proxyRoute.enabled && proxyRoute.url) {
            const agent = await proxyAgentForWebSocket(proxyRoute.url);
            if (agent) wsOptions.agent = agent;
            else if (proxyRoute.strict) {
              throw new Error("WebSocket proxy required but unavailable");
            }
          }
          ws = new WebSocketCtor(input.wsUrl, wsOptions);

          const sendChat = () => {
            ws?.send(keepaliveFrame());
            ws?.send(encodeFrame(buildChatInvocation({
              traceId,
              sessionId,
              isStartOfSession: true,
              ...input.invocation
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

              const snapshot = extractBotText(frame);
              if (input.stream && snapshot && previousText && !snapshot.startsWith(previousText)) {
                abort("Microsoft 365 Copilot rewrote streamed content; retry without streaming.");
                return;
              }
              const { delta, next } = accumulateBotContent(previousText, frame);
              previousText = next;
              if (delta) {
                resetStallTimer();
                if (input.stream) controller.enqueue(encoder.encode(makeSseChunk(input.model, { content: delta })));
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
            abort(err instanceof Error ? err.message : "Microsoft 365 Copilot WebSocket error", webSocketAuthStatus(err));
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
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const diagnosticUrl = "wss://substrate.office.com/m365Copilot/Chathub";
    const wrap = (response, url = diagnosticUrl, transformedBody = null) => ({
      response,
      url,
      headers: {},
      transformedBody
    });

    let history;
    try {
      history = promptFromMessages(messages);
    } catch (error) {
      return wrap(m365ErrorResponse(error, model));
    }
    const text = history.text.trim();
    if (!text) return wrap(jsonError("No user message provided", 400));

    const connectionParams = resolveConnectionParams(input.credentials);
    if ("error" in connectionParams) {
      return wrap(
        jsonError(connectionParams.error, connectionParams.expired ? 401 : 400),
        diagnosticUrl,
        { model, prompt: text.slice(0, 100) }
      );
    }
    const logged = { model, prompt: text.slice(0, 100) };

    const { tools, toolChoice } = extractToolSpec(body);
    const toolOptions = { toolChoice, parallelToolCalls: body.parallel_tool_calls !== false };
    const instructions = buildM365ToolInstructions(tools, toolOptions);
    // Tool calls are parsed from the whole answer, so a tool-enabled request is one buffered turn.
    const buffered = !stream || instructions.length > 0;

    // Continue this connection's conversation when the request extends our previous reply: only
    // the messages after it are sent. Anything else opens a fresh conversation with the whole history.
    const conversations = m365Conversations();
    const scope = conversationScope(input.credentials, model, connectionParams, tools);
    const claimed = scope ? conversations.claim(scope, messages) : null;
    const delta = claimed ? promptFromMessages(claimed.delta) : null;
    const resume = claimed && delta?.text.trim() ? claimed : null;
    const turnText = resume ? delta.text.trim() : [instructions, text].filter(Boolean).join("\n\n");
    if (turnText.length > M365_MAX_TEXT_LENGTH) {
      return wrap(m365ErrorResponse(
        new M365ExecutorError(400, "m365_input_too_large", "Microsoft 365 Copilot input exceeded the size limit."),
        model
      ));
    }
    const imageRefs = resume ? delta.imageRefs : history.imageRefs;

    const wsUrl = buildWsUrl(connectionParams, resume?.ids);
    const urlParts = new URL(wsUrl);
    const ids = {
      conversationId: urlParts.searchParams.get("ConversationId"),
      sessionId: urlParts.searchParams.get("X-SessionId")
    };

    // Uploads are keyed to the conversation, so each turn uploads its own images: all of them for a
    // fresh conversation, only the new messages' for a continued one. A failed upload fails the request.
    const messageAnnotations = [];
    try {
      for (const image of await new M365ImageResolver(input.signal).resolve(imageRefs)) {
        messageAnnotations.push(await uploadM365Image({
          host: connectionParams.host,
          accessToken: connectionParams.accessToken,
          conversationId: ids.conversationId,
          image,
          signal: input.signal
        }));
      }
    } catch (error) {
      if (!(error instanceof M365ExecutorError)) throw error;
      return wrap(m365ErrorResponse(error, model), redactWsUrl(wsUrl), logged);
    }

    const turns = (resume?.turns ?? 0) + 1;
    let completed = "";
    const wsStream = await this.wsChat({
      wsUrl,
      model,
      signal: input.signal,
      stream: stream && !buffered,
      invocation: {
        text: turnText,
        conversationId: ids.conversationId,
        requestId: urlParts.searchParams.get("chatsessionid"),
        isStartOfSession: !resume,
        messageAnnotations,
        ...(instructions ? { plugins: clientPlugins(tools), toolChoice, customInstructions: instructions } : null)
      },
      // A failed turn is never committed, so a broken conversation is not resumed.
      onDone: (answer) => {
        completed = answer;
      },
      proxyOptions: input.proxyOptions
    });
    const commit = (reply) => {
      if (scope) conversations.commit(scope, messages, ids, m365ReplyFingerprint(reply), turns);
    };

    if (stream && !buffered) {
      // Commit once the relayed stream reaches its end without error.
      const reader = wsStream.getReader();
      const relay = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            if (completed) commit({ text: completed, calls: [] });
            controller.close();
            return;
          }
          controller.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        }
      });
      return wrap(new Response(relay, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
      }), redactWsUrl(wsUrl), logged);
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
            return wrap(sseErrorResponse(parsed.error), redactWsUrl(wsUrl), logged);
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (isString(content)) fullText += content;
        } catch {

          // Skip malformed SSE lines.
        }}
    }

    const output = m365Output(model);
    const parsed = parseM365ToolOutput(fullText, tools, toolOptions);
    if (parsed.constraintViolation) {
      return wrap(m365ErrorResponse(
        new M365ExecutorError(502, "m365_tool_constraint", "Microsoft 365 Copilot did not satisfy the requested tool contract."),
        model
      ), redactWsUrl(wsUrl), logged);
    }
    if (completed) commit(parsed);
    const response = stream ?
    new Response(output.bufferedSse(parsed), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
    }) :
    output.json(parsed);
    return wrap(response, redactWsUrl(wsUrl), logged);
  }
}

/**
 * Which conversations a request may continue: same connection (Copilot keeps conversations per
 * account), same model, request profile and tool set. Null without a connection identity, so the
 * request stays stateless, and two connections can never share a conversation.
 */
function conversationScope(credentials, model, params, tools) {
  const connectionId = isRecord(credentials) ? credentials.connectionId : undefined;
  if (!isString(connectionId) || !connectionId) return null;
  return [
  connectionId,
  model,
  params.scenario ?? "",
  params.licenseType ?? "",
  params.agent ?? "",
  tools.map((tool) => tool.name).sort().join(",")].
  join("|");
}
