import WebSocket from "ws";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError } from "./sendRequest.js";
import { settleProviderAttemptDispatch, transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
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
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { webSocketAuthStatus } from "../utils/webSessionExpiry.js";
import { m365Conversations, m365ReplyFingerprint } from "./copilot-m365-conversations.js";
import { M365ImageResolver, uploadM365Image } from "./copilot-m365-images.js";
import { M365ExecutorError, m365ErrorResponse, m365Failure, m365Output } from "./copilot-m365-output.js";
import { M365TurnComposer } from "./copilot-m365-composer.js";
import { M365TurnError, m365FrameError, m365UpgradeThrottle } from "./copilot-m365-turn.js";
import { resolveM365Profile } from "./copilot-m365-profile.js";
const M365_MAX_FRAME_BYTES = 1024 * 1024;
const M365_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const RECORD_SEPARATOR = String.fromCharCode(0x1e);
const metricsFrame = () => JSON.stringify({
  arguments: [{ Timestamps: { ConnectionEstablished: "", ConnectionStart: "", UserInputStart: "", UserInputSubmit: "" } }],
  target: "Metrics",
  type: 1
}) + RECORD_SEPARATOR;
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

/** The WebSocket constructor in use (tests substitute a fake). */
export function m365WebSocketCtor() {
  return WebSocketCtor;
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

/** A typed failure becomes its typed response; anything else keeps the message-and-status shape. */
function failureResponse(error, model) {
  if (error instanceof M365TurnError || error instanceof M365ExecutorError) return m365ErrorResponse(error, model);
  return sseErrorResponse(error);
}

/** The SSE `error` envelope of a failure that happens after the stream was committed. */
function failureEnvelope(error, model) {
  if (error instanceof M365TurnError || error instanceof M365ExecutorError) {
    const failure = m365Failure(error, model);
    return { ...failure.body.error, status: failure.status };
  }
  const envelope = { message: sanitizeErrorMessage(error?.message || "Microsoft 365 Copilot stream error") };
  if (error?.status === 401 || error?.status === 403) envelope.status = error.status;
  return envelope;
}

/**
 * Run one Chathub turn: handshake, send `invocation`, hand every later frame to `onFrame`, and
 * resolve on the completion frame. Rejects with an `M365TurnError` for a typed refusal (licence,
 * throttling, credits, safety stop) or an `Error` carrying a sanitized message and, for a refused
 * upgrade, the 401/403 status. An exception thrown by `onFrame` ends the turn with that error.
 */
export function runM365Socket({ wsUrl, invocation, signal, onFrame, proxyOptions }) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let settled = false;
    let buffer = "";
    let handshakeComplete = false;
    let completionReceived = false;
    let receivedBytes = 0;
    let timeout = null;

    const onAbort = () => {
      try {
        if (ws?.readyState === 1 && handshakeComplete) {
          ws.send(JSON.stringify({ type: 1, invocationId: "1", target: "stop", arguments: [{}] }) + RECORD_SEPARATOR);
        }
      } catch { /* cancellation wins over a failed stop send */ }
      fail("Request aborted");
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (ws) {
        try {ws.close();} catch {/* ignore */}
        ws = null;
      }
    };
    const done = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);else
      resolve();
    };
    function fail(message, status) {
      const error = new Error(sanitizeErrorMessage(message));
      if (status) error.status = status;
      done(error);
    }
    const resetStallTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fail("Microsoft 365 Copilot WebSocket stall timeout"), FETCH_CONNECT_TIMEOUT_MS);
    };

    if (signal?.aborted) {
      fail("Request aborted");
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => fail("Microsoft 365 Copilot WebSocket timeout"), FETCH_CONNECT_TIMEOUT_MS);

    (async () => {
    try {
      const proxyRoute = resolveWebSocketProxyRoute(wsUrl, proxyOptions);
      const agent = proxyRoute.enabled && proxyRoute.url ? await proxyAgentForWebSocket(proxyRoute.url) : null;
      if (proxyRoute.strict && !agent) throw new Error("WebSocket proxy required but unavailable");
      if (settled) return;
      ws = new WebSocketCtor(wsUrl, {
        maxPayload: M365_MAX_RESPONSE_BYTES,
        ...(agent ? { agent } : null),
        headers: {
          Origin: "https://m365.cloud.microsoft",
          "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        }
      });
      ws.on("open", () => ws?.send(handshakeFrame()));
      // A refused upgrade: only the status and Retry-After are read, never the body.
      ws.on("unexpected-response", (_request, response) => {
        response?.resume?.();
        const throttled = m365UpgradeThrottle(response);
        if (throttled) return done(throttled);
        const status = Number(response?.statusCode) || 0;
        fail(`Unexpected server response: ${status}`, status === 401 || status === 403 ? status : undefined);
      });
      ws.on("message", (data) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data.toString());
        receivedBytes += bytes.byteLength;
        if (receivedBytes > M365_MAX_RESPONSE_BYTES) return fail("Microsoft 365 Copilot response exceeded the size limit");
        buffer += bytes.toString("utf8");
        const split = splitFrames(buffer);
        buffer = split.rest;
        for (const rawFrame of split.frames) {
          if (settled) return;
          if (Buffer.byteLength(rawFrame) > M365_MAX_FRAME_BYTES) return fail("Microsoft 365 Copilot frame exceeded the size limit");
          const frame = parseFrame(rawFrame);
          if (!handshakeComplete) {
            const error = handshakeError(frame);
            if (error) return fail(`Microsoft 365 Copilot handshake failed: ${error}`);
            handshakeComplete = true;
            resetStallTimer();
            ws?.send(keepaliveFrame());
            ws?.send(encodeFrame(invocation));
            ws?.send(metricsFrame());
            continue;
          }
          if (!frame || frame.type === 6) continue;
          const typed = m365FrameError(frame);
          if (typed) return done(typed);
          if (isCompletionFrame(frame) && frame.error) {
            return fail(`Microsoft 365 Copilot completion error: ${frame.error}`);
          }
          resetStallTimer();
          try {
            onFrame?.(frame);
          } catch (error) {
            return done(error);
          }
          if (frame.type === 2) completionReceived = true;
          if (isCompletionFrame(frame)) {
            completionReceived = true;
            return done();
          }
        }
        if (Buffer.byteLength(buffer) > M365_MAX_FRAME_BYTES) return fail("Microsoft 365 Copilot frame exceeded the size limit");
      });
      ws.on("error", (err) => {
        fail(err instanceof Error ? err.message : "Microsoft 365 Copilot WebSocket error", webSocketAuthStatus(err));
      });
      ws.on("close", () => {
        if (settled) return;
        if (completionReceived) done();else
        fail(handshakeComplete ?
        "Microsoft 365 Copilot WebSocket closed before completion" :
        "Microsoft 365 Copilot WebSocket closed before handshake");
      });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Failed to connect to Microsoft 365 Copilot");
    }
    })();
  });
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


  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    // The latest chat turn on the wire; every result after it carries its quota ticket.
    let sent = null;
    let dispatch = null;
    const body = input.body || {};
    const model = input.model || body.model || "copilot-m365";
    const stream = input.stream !== false;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const diagnosticUrl = "wss://substrate.office.com/m365Copilot/Chathub";
    const wrap = (response, url = diagnosticUrl, transformedBody = null) => {
      transferProviderAttemptDispatch(sent, response);
      return {
        response,
        url,
        headers: {},
        transformedBody,
        attemptStartedAt: sender.attemptStartedAt
      };
    };

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

    // Tone, scenario, licence and agent: explicit connection fields, then the requested model's
    // documented profile, then the tier (explicit or chosen from the account).
    const psd = isRecord(input.credentials?.providerSpecificData) ? input.credentials.providerSpecificData : {};
    const field = (key) => isString(psd[key]) && psd[key] ? psd[key] : undefined;
    const profile = resolveM365Profile({
      model,
      tier: connectionParams.tier,
      tone: field("tone"),
      scenario: field("scenario"),
      licenseType: field("licenseType"),
      agent: field("agent")
    });
    // Every turn is a temporary chat unless the connection opts out with `temporaryChat: false`.
    const routeParams = {
      ...connectionParams,
      scenario: profile.scenario,
      licenseType: profile.licenseType,
      agent: profile.agent,
      disableMemory: psd.temporaryChat !== false
    };

    // Continue this connection's conversation when the request extends our previous reply: only
    // the messages after it are sent. Anything else opens a fresh conversation with the whole history.
    const conversations = m365Conversations();
    const scope = conversationScope(input.credentials, model, profile, routeParams.disableMemory, tools);
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

    const wsUrl = buildWsUrl(routeParams, resume?.ids);
    const redactedUrl = redactWsUrl(wsUrl);
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
          signal: input.signal,
          proxyOptions: input.proxyOptions,
          // An upload is setup: it uses the transport policy but charges no quota.
          send: (url, init, proxyOptions) => sender.sendRequest(url, init, proxyOptions, { quotaBearing: false })
        }));
      }
    } catch (error) {
      if (!(error instanceof M365ExecutorError)) throw error;
      return wrap(m365ErrorResponse(error, model), redactedUrl, logged);
    }

    const invocation = buildChatInvocation({
      traceId: urlParts.searchParams.get("clientrequestid") ?? crypto.randomUUID().replace(/-/g, ""),
      sessionId: ids.sessionId,
      conversationId: ids.conversationId,
      requestId: urlParts.searchParams.get("chatsessionid"),
      isStartOfSession: !resume,
      text: turnText,
      tone: profile.tone,
      messageAnnotations,
      ...(instructions ? { plugins: clientPlugins(tools), toolChoice, customInstructions: instructions } : null)

    });
    const turns = (resume?.turns ?? 0) + 1;
    // A failed turn is never committed, so a broken conversation is not resumed.
    const commit = (reply) => {
      if (scope) conversations.commit(scope, messages, conversationIds, m365ReplyFingerprint(reply), turns);
    };
    let composer = new M365TurnComposer();
    let conversationIds = ids;
    let finalResultMessage = "";
    const absorbFinal = (frame) => {
      const message = extractFinalResultMessage(frame);
      if (message) finalResultMessage = message;
    };
    // Starting a socket turn is the physical send. It stands in for response headers,
    // so the socket's own stall timers bound the turn, not the header deadline.
    const sendTurn = async (url, turnInvocation, signal, onFrame) => {
      dispatch = sender.sendRequest(redactWsUrl(url), { signal }, input.proxyOptions, {
        transport: ({ signal: turnSignal }) => ({
          done: runM365Socket({ wsUrl: url, proxyOptions: input.proxyOptions, invocation: turnInvocation, signal: turnSignal, onFrame })
        })
      });
      sent = await dispatch;
      await sent.done;
    };
    const runTurn = async (onFrame, signal = input.signal) => {
      try {
        await sendTurn(wsUrl, invocation, signal, onFrame);
      } catch (error) {
        if (error?.code !== "M365_INTERNAL_ERROR" || composer.text || finalResultMessage || signal?.aborted) throw error;
        // InternalError leaves the current conversation unusable. Retry once with entirely new
        // conversation/session identifiers; a second refusal is returned to the caller.
        const freshUrl = buildWsUrl(routeParams);
        const freshParts = new URL(freshUrl);
        conversationIds = {
          conversationId: freshParts.searchParams.get("ConversationId"),
          sessionId: freshParts.searchParams.get("X-SessionId")
        };
        const freshInvocation = structuredClone(invocation);
        const args = freshInvocation.arguments[0];
        args.conversationId = conversationIds.conversationId;
        args.sessionId = conversationIds.sessionId;
        args.isStartOfSession = true;
        args.message.requestId = freshParts.searchParams.get("chatsessionid");
        composer = new M365TurnComposer();
        finalResultMessage = "";
        await settleProviderAttemptDispatch(sent, { reason: "fallback" });
        await sendTurn(freshUrl, freshInvocation, signal, onFrame);
      }
    };
    const output = m365Output(model);

    if (!buffered) {
      // Hold the HTTP commitment until the first published text or a failure, so a licence or
      // throttling refusal answers with its own status instead of a 200 stream.
      let ready;
      const first = new Promise((resolve) => {
        ready = resolve;
      });
      const controller = new AbortController();
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
      const encoder = new TextEncoder();
      let cancelled = false;
      const relay = new ReadableStream({
        start(sink) {
          const send = (text) => {
            if (!cancelled) sink.enqueue(encoder.encode(text));
          };
          runTurn(
            (frame) => {
              absorbFinal(frame);
              const update = composer.push(frame);
              if (update.streamingDiverged) throw new M365ExecutorError(502, "m365_stream_rewritten", "Microsoft 365 Copilot rewrote streamed content; retry without streaming.");
              if (update.reasoningDelta) send(output.chunk({ reasoning_content: update.reasoningDelta }));
              if (update.delta) send(output.chunk({ content: update.delta, ...(update.annotations.length ? { annotations: update.annotations } : null) }));
              if (update.delta || update.reasoningDelta) ready();
            },
            signal,
          ).then(
            () => {
              const answer = composer.text || finalResultMessage;
              if (!composer.text && finalResultMessage) send(output.chunk({ content: finalResultMessage }));
              if (answer) commit({ text: answer, calls: [] });
              send(output.chunk({}, "stop") + "data: [DONE]\n\n");
              if (!cancelled) sink.close();
              ready();
            },
            (error) => {
              ready(error);
              send(`data: ${JSON.stringify({ error: failureEnvelope(error, model) })}\n\n`);
              if (!cancelled) sink.close();
            }
          );
        },
        cancel() {
          cancelled = true;
          controller.abort();
        }
      }, { highWaterMark: 16384 });
      const earlyError = await first;
      // The first frame can beat the sender's bookkeeping; the ticket must be bound before wrapping.
      await dispatch?.catch(() => {});
      if (earlyError) {
        await relay.cancel().catch(() => {});
        if (isQuotaDispatchUnavailable(earlyError)) throw earlyError;
        return wrap(failureResponse(earlyError, model), redactedUrl, logged);
      }
      return wrap(new Response(relay, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
      }), redactedUrl, logged);
    }

    try {
      await runTurn((frame) => {
          absorbFinal(frame);
          composer.push(frame);
        });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      return wrap(failureResponse(error, model), redactedUrl, logged);
    }

    const answer = composer.text || finalResultMessage;
    const parsed = parseM365ToolOutput(answer, tools, toolOptions);
    if (parsed.constraintViolation) {
      return wrap(m365ErrorResponse(
        new M365ExecutorError(502, "m365_tool_constraint", "Microsoft 365 Copilot did not satisfy the requested tool contract."),
        model
      ), redactedUrl, logged);
    }
    if (answer) commit(parsed);
    // Citation offsets index the composed answer; they hold only while it is returned as is.
    const cited = !parsed.calls.length && parsed.text === composer.text;
    const result = { ...parsed, annotations: cited ? composer.annotations : [], reasoning: composer.reasoning };
    const response = stream ?
    new Response(output.bufferedSse(result), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
    }) :
    output.json(result);
    return wrap(response, redactedUrl, logged);
  }
}

/**
 * Which conversations a request may continue: same connection (Copilot keeps conversations per
 * account), same model, request profile (scenario, licence, agent, tone, temporary chat) and tool set. Null without a connection identity, so the
 * request stays stateless, and two connections can never share a conversation.
 */
function conversationScope(credentials, model, profile, temporary, tools) {
  const connectionId = isRecord(credentials) ? credentials.connectionId : undefined;
  if (!isString(connectionId) || !connectionId) return null;
  return [
  connectionId,
  model,
  profile.scenario ?? "",
  profile.licenseType ?? "",
  profile.agent ?? "",
  profile.tone ?? "",
  temporary ? "temporary" : "",
  tools.map((tool) => tool.name).sort().join(",")].
  join("|");
}
