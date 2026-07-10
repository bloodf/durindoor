import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { applyThinking, parseSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { validateOutboundPayload, stripInternalKeys, normalizeToolSchemaRoots } from "../translator/validate.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, VALIDATE_OUTBOUND } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { acquireSlot, releaseSlot, getConcurrencyLimit, ConcurrencyGateTimeoutError } from "../services/concurrencyGate.js";
import { getExecutor } from "../executors/index.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { resolveStreamFlag } from "./chatCore/streamFlag.js";
import { createEmptyRetryStream } from "./chatCore/emptyStreamGuard.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { stripOrphanedToolResults } from "../translator/concerns/toolCall.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages } from "../rtk/index.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { compressWithPxpipe, normalizePxpipeResult } from "../rtk/pxpipe.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { extractThinking } from "../translator/concerns/thinkingUnified.js";
import { resolveSessionId } from "../utils/sessionManager.js";

const NATIVE_TOOL_RESULT_FORMATS = new Set([
  FORMATS.GEMINI,
  FORMATS.GEMINI_CLI,
  FORMATS.ANTIGRAVITY,
  FORMATS.VERTEX,
]);

function isCompactResponsesEndpoint(endpoint) {
  const path = String(endpoint || "").split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return path.endsWith("/v1/responses/compact");
}

/**
 * Build immutable request-only metadata before logging or translation. The
 * legacy body marker remains accepted for compatibility, but is removed from
 * both working and diagnostic copies before either can leave the process.
 */
function captureRequestContext(body, clientRawRequest) {
  const compact = isCompactResponsesEndpoint(clientRawRequest?.endpoint)
    || body?._compact === true
    || clientRawRequest?.body?._compact === true;
  const clientHeaders = Object.freeze({ ...(clientRawRequest?.headers || {}) });
  return Object.freeze({ compact, clientHeaders });
}

function stripLegacyCompactMarker(body, clientRawRequest) {
  let cleanBody = body;
  let cleanRawRequest = clientRawRequest;

  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "_compact")) {
    cleanBody = { ...body };
    delete cleanBody._compact;
  }
  if (clientRawRequest?.body && typeof clientRawRequest.body === "object"
    && Object.prototype.hasOwnProperty.call(clientRawRequest.body, "_compact")) {
    const rawBody = { ...clientRawRequest.body };
    delete rawBody._compact;
    cleanRawRequest = { ...clientRawRequest, body: rawBody };
  }

  return { body: cleanBody, clientRawRequest: cleanRawRequest };
}

/**
 * Gemini-family clients legitimately send functionResponse turns without the
 * originating functionCall after trimming their local history. Their native
 * APIs accept that history and the Gemini translators preserve the content.
 * Applying the generic orphan cleaner to those wire formats silently deletes
 * user-visible tool output before dispatch.
 */
export function shouldStripOrphanedToolResults(format) {
  return !NATIVE_TOOL_RESULT_FORMATS.has(format);
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, onUpstreamEmptyExhausted, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled, pxpipeMinChars, pxpipeTimeoutMs, pxpipeTransform, onPxpipeEvent, sourceFormatOverride, providerThinking, providerConcurrencyLimit }) {
  const { provider, model: requestedModel } = modelInfo;
  const requestStartTime = Date.now();
  const requestContext = captureRequestContext(body, clientRawRequest);
  ({ body, clientRawRequest } = stripLegacyCompactMarker(body, clientRawRequest));

  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: clientRawRequest?.headers, body, connectionId, scope: provider });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession ? log.tagForSession(sessionSeed) : (log?.nextTag ? log.nextTag() : "");

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, requestedModel, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  // Parse the request-only dashboard suffix once. The raw ID is retained only
  // for client-visible bypass identity; routing, compression, accounting, and
  // provider dispatch consistently use the clean catalog identity.
  const parsedModel = parseSuffix(requestedModel);
  const cleanModel = parsedModel.cleanModel;
  const modelThinkingIntent = parsedModel.override;
  body = { ...body, model: cleanModel };
  const modelTargetFormat = getModelTargetFormat(alias, cleanModel);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation.
  // If found, force targetFormat=sourceFormat so we skip translation entirely —
  // otherwise the body could be translated to modelTargetFormat and sent to a
  // transport that doesn't understand it.
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const skipTranslation = runtimeTransport?.format === sourceFormat;
  if (skipTranslation && credentials) credentials.runtimeTransport = runtimeTransport;
  const targetFormat = skipTranslation
    ? sourceFormat
    : (modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider, credentials));
  const stripList = getModelStrip(alias, cleanModel);
  const cleanUpstreamModel = getModelUpstreamId(alias, cleanModel); // provider-facing model id

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, cleanModel);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(cleanModel);

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);

  // Client Accept header preference (AI SDK sends Accept: application/json for
  // non-streaming responses).
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");

  // Stream-only providers (forceStream) must keep streaming even when the client
  // asked for JSON; the accumulated stream is converted to JSON downstream. (#2031)
  // Provider-declared forceNonStreaming (e.g. Galadriel's verified API
  // rejects streaming chat requests; synthesize SSE downstream).
  const providerForcesNonStreaming = PROVIDERS[provider]?.forceNonStreaming === true;
  // Stream-only providers (forceStream) must keep streaming even when the client
  // asked for JSON; the accumulated stream is converted to JSON downstream. (#2031)
  let stream = resolveStreamFlag({
    providerRequiresStreaming,
    bodyStream: body.stream,
    forceNonStreaming:
      (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli" || provider === "agy"))
      || providerForcesNonStreaming
      || (detectedTool === "deepseek-tui" && body.stream !== true),
    clientPrefersJson,
    clientPrefersSSE,
  });

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, cleanModel);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, cleanModel);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${cleanModel}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  // Strip orphaned tool results before translation so the translator never sees
  // stale call_id references that client-side history truncation left behind.
  const preStripped = shouldStripOrphanedToolResults(sourceFormat)
    ? stripOrphanedToolResults(body)
    : 0;
  if (preStripped > 0) {
    log?.debug?.("TOOLCLEAN", `pre-translation: stripped ${preStripped} orphaned tool result(s)`);
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: cleanUpstreamModel };
    applyThinking(targetFormat, cleanModel, translatedBody, provider, modelThinkingIntent);
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model, provider);
  } else {
    translatedBody = translateRequest(
      sourceFormat,
      targetFormat,
      cleanUpstreamModel,
      body,
      stream,
      credentials,
      provider,
      reqLogger,
      stripList,
      connectionId,
      clientTool,
      { thinkingIntent: modelThinkingIntent, capabilityModel: cleanModel },
    );
    if (!translatedBody) {
      trackPendingRequest(cleanModel, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    // Kiro carries the provider model inside every native userInputMessage.
    // Adding a stray OpenAI-style top-level model obscures boundary validation.
    if (targetFormat !== FORMATS.KIRO) translatedBody.model = cleanUpstreamModel;
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || requestedModel;
    const msgN = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || body.messages?.length || body.input?.length || 0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
    const think = log.fmtThink?.(extractThinking(translatedBody));
    const acc = credentials?.connectionName || credentials?.connectionId?.slice(0, 8) || "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${cleanModel}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, cleanModel) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // Claude tool schema requires `type` to be explicitly set; strict gateways (e.g., MiniMax)
  // reject legacy payloads that omit it with HTTP 400. Default to "custom" when missing.
  if (finalFormat === "claude" && Array.isArray(translatedBody.tools)) {
    translatedBody.tools = translatedBody.tools.map(tool => tool.type ? tool : { type: "custom", ...tool });
  }

  // Token-saver summary parts, printed as one "⚙" line at the end (only active ones)
  const xf = [];

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  if (rtkStats?.hits?.length) {
    const saved = rtkStats.bytesBefore - rtkStats.bytesAfter;
    const pct = rtkStats.bytesBefore > 0 ? ((saved / rtkStats.bytesBefore) * 100).toFixed(0) : "0";
    xf.push(`RTK −${saved}B(${pct}%)`);
  }

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, { enabled: headroomEnabled, url: headroomUrl, model: cleanUpstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  if (headroomStats) {
    const before = headroomStats.tokens_before || 0;
    const delta = headroomStats.tokens_saved || 0;
    const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
    xf.push(`HEADROOM −${delta}tok(${pct}%)`);
    log?.info?.("HEADROOM", formatHeadroomLog(headroomStats));
    log?.info?.("HEADROOM", formatHeadroomSizeLog(headroomDiagnostics));
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${formatHeadroomSizeLog(headroomDiagnostics)}`);
    }
  } else if (headroomEnabled) {
    log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);
  }

  // Strip orphaned tool results again after RTK/Headroom compression — both
  // compressors can remove assistant turns containing tool_calls, which would
  // otherwise leave dangling tool results that strict providers reject with 400.
  const postStripped = shouldStripOrphanedToolResults(finalFormat)
    ? stripOrphanedToolResults(translatedBody)
    : 0;
  if (postStripped > 0) {
    log?.debug?.("TOOLCLEAN", `post-compression: stripped ${postStripped} orphaned tool result(s)`);
  }

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    const pxpipeDiagnostics = {};
    const pxpipeResult = normalizePxpipeResult(await compressWithPxpipe(translatedBody, {
      enabled: true, format: finalFormat, model: cleanUpstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform,
      diagnostics: pxpipeDiagnostics,
    }), pxpipeDiagnostics);
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    if (pxpipeSummary?.applied) xf.push(`PXPIPE:${pxpipeSummary.imageCount}img`);
    try { onPxpipeEvent?.({ provider, model: cleanModel, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
  }

  // Re-strip after PXPIPE in case compression removed assistant/tool turns.
  const pxpipeStripped = shouldStripOrphanedToolResults(finalFormat)
    ? stripOrphanedToolResults(translatedBody)
    : 0;
  if (pxpipeStripped > 0) {
    log?.debug?.("TOOLCLEAN", `post-pxpipe: stripped ${pxpipeStripped} orphaned tool result(s)`);
  }

  if (xf.length && log?.line) log.line(reqTag, "⚙", xf.join(" · "));

  const executor = getExecutor(provider);
  trackPendingRequest(cleanModel, provider, connectionId, true);
  appendRequestLog({ model: cleanModel, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${cleanModel} | ${msgCount} msgs`);

  // --- Per-provider concurrency gate (declaration before streamController closures) ---
  const concurrencyLimit = getConcurrencyLimit(provider, providerConcurrencyLimit);
  let slotAcquired = false;

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(cleanModel, provider, connectionId, false);
      if (slotAcquired) releaseSlot(provider);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => {
      trackPendingRequest(cleanModel, provider, connectionId, false);
      if (slotAcquired) releaseSlot(provider);
    },
    log, provider, model: cleanModel, reqTag
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${cleanModel} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${cleanModel} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${cleanModel} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // #6375: coerce root `type: null`/missing on tool function parameters to
  // `type: "object"` BEFORE the gate, unconditionally — passthrough (source ===
  // target) requests skip translation and would otherwise carry a Codex-emitted
  // `type: null` root straight to an OpenAI-compatible upstream that 400s it.
  normalizeToolSchemaRoots(translatedBody);

  // Outbound validation gate. Run format-specific shape checks (which also
  // catch leftover internal keys) FIRST so the gate can return 400 with a
  // precise error. After the gate passes, strip any remaining underscore
  // keys defensively — this is the passthrough safety net.
  if (VALIDATE_OUTBOUND) {
    const validation = validateOutboundPayload(finalFormat, translatedBody);
    if (!validation.ok) {
      const summary = validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      const errMsg = `Outbound validation failed for ${finalFormat}: ${summary}`;
      log?.warn?.("VALIDATE", errMsg);
      trackPendingRequest(cleanModel, provider, connectionId, false, true);
      appendRequestLog({ model: cleanModel, provider, connectionId, status: `FAILED ${HTTP_STATUS.BAD_REQUEST}` }).catch(() => { });
      saveRequestDetail(buildRequestDetail({
        provider, model: cleanModel, connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: translatedBody || null,
        response: { error: errMsg, status: HTTP_STATUS.BAD_REQUEST, thinking: null },
        status: "error"
      })).catch(() => { });
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, errMsg);
    }
  }
  // Defensive strip AFTER the gate.
  stripInternalKeys(translatedBody);

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;

  // --- Per-provider concurrency gate ---
  // Acquire a slot before sending the upstream request.  This proactively
  // limits concurrent in-flight requests per provider, preventing 429s before
  // they happen.  If the slot can't be acquired within the timeout, return 503.
  if (concurrencyLimit > 0) {
    try {
      await acquireSlot(provider, concurrencyLimit);
      slotAcquired = true;
      log?.debug?.("CONCURRENCY", `${provider} | slot acquired (${concurrencyLimit} max)`);
    } catch (e) {
      if (e instanceof ConcurrencyGateTimeoutError) {
        log?.warn?.("CONCURRENCY", `${provider} | gate timeout after ${e.timeoutMs}ms (${e.limit} max)`);
        return createErrorResult(HTTP_STATUS.SERVICE_UNAVAILABLE, e.message);
      }
      throw e;
    }
  }

  try {
    const result = await executor.execute({ model: cleanUpstreamModel, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions, requestContext });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(cleanModel, provider, connectionId, false, true);
    if (slotAcquired) releaseSlot(provider);
    appendRequestLog({ model: cleanModel, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model: cleanModel, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, requestedModel, HTTP_STATUS.BAD_GATEWAY);
    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `ERROR 502 · ${provider}/${cleanModel} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error.stack ? `\n    ${error.stack}` : ""}`);
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      const newCredentials = await refreshWithRetry(() => executor.refreshCredentials(credentials, log), 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        if (log?.line) log.line(reqTag, "🔑", `TOKEN REFRESHED · ${provider}/${cleanModel}`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model: cleanUpstreamModel, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions, requestContext });
          if (retryResult.response.ok) { providerResponse = retryResult.response; providerUrl = retryResult.url; }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(cleanModel, provider, connectionId, false, true);
    if (slotAcquired) releaseSlot(provider);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model: cleanModel, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model: cleanModel, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error"
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, requestedModel, statusCode);
    if (log?.errorLine) {
      const urlStr = providerUrl ? `\n    URL: ${providerUrl}` : "";
      log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${cleanModel} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`);
    }
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  // Antigravity/AGY empty-stream guard — oh-my-pi parity: bytes (thinking included)
  // stream to the client live; emptiness is judged per upstream attempt and an
  // empty attempt is retried in-stream with the identical request, spliced into
  // the same client message (see emptyStreamGuard.js). Exhaustion surfaces as an
  // in-stream error event (retryable by Claude Code); onUpstreamEmptyExhausted
  // lets the caller bench the account so the client's retry rotates to the next
  // one (#2188, #2229, #2250, #2259).
  if ((provider === "antigravity" || provider === "agy") && stream && providerResponse.body) {
    const reexecute = async () => {
      const retryResult = await executor.execute({ model: cleanUpstreamModel, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions, requestContext });
      if (!retryResult.response.ok) {
        const { statusCode, message } = await parseUpstreamError(retryResult.response, executor);
        throw new Error(`[${statusCode}] ${message}`);
      }
      if (!retryResult.response.body) throw new Error("upstream returned no body");
      return retryResult.response.body;
    };
    providerResponse = new Response(
      createEmptyRetryStream({
        body: providerResponse.body,
        reexecute,
        signal: streamController.signal,
        log,
        onExhausted: (reason, { upstreamError } = {}) => {
          if (!onUpstreamEmptyExhausted) return;
          // Quota-style exhaustion carries the reset time only inside the error
          // message ("Your quota will reset after 2h7m23s") — bench precisely.
          const resetMs = executor.parseRetryFromErrorMessage?.(upstreamError?.message || reason);
          return onUpstreamEmptyExhausted(
            formatProviderError(new Error(reason), provider, cleanModel, HTTP_STATUS.BAD_GATEWAY),
            resetMs ? Date.now() + resetMs : undefined
          );
        },
      }),
      { status: providerResponse.status, headers: providerResponse.headers }
    );
  }

  const sharedCtx = { provider, model: cleanModel, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, pxpipe: pxpipeSummary, reqTag, log };
  const appendLog = (extra) => appendRequestLog({ model: cleanModel, provider, connectionId, ...extra }).catch(() => { });
  // Release the concurrency slot when the request completes (covers streaming + non-streaming + disconnect)
  const trackDone = () => {
    trackPendingRequest(cleanModel, provider, connectionId, false);
    if (slotAcquired) releaseSlot(provider);
  };

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response. When the client asked for streaming but the
  // provider forced non-streaming upstream, synthesize SSE bytes from the JSON
  // body inside handleNonStreamingResponse so the SSE client contract holds.
  if (!stream) {
    const streamToClient = clientRequestedStreaming === true;
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog, streamToClient });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
