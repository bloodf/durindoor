import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveKiroModel } from "../config/kiroConstants.js";
import { v4 as uuidv4 } from "uuid";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import {
  resolveKiroRegion,
  buildKiroBaseUrls,
  buildKiroProfileEndpoint,
  regionFromProfileArn,
  KIRO_DEFAULT_REGION,
} from "../config/kiroRegions.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Strict AWS region id allowlist (incl. GovCloud partition `us-gov-west-1`),
// matching the Bedrock validator shape. Used as a trust-boundary guard before
// interpolating a stored/ARN-derived region into a `q.<region>.amazonaws.com`
// host (SSRF). Stored credentials and ARN segments are untrusted input.
const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/;
function isValidAwsRegion(r) {
  return typeof r === "string" && AWS_REGION_PATTERN.test(r.toLowerCase());
}

// Region the data plane must target: the profile's own region is authoritative
// (Q Developer profile can live in a different region than the Identity Center
// that minted the token), then explicit credential region, then default.
// Each candidate is validated before it can be interpolated into a host.
function resolveKiroRuntimeRegion(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const fromArn = regionFromProfileArn(psd.profileArn);
  if (isValidAwsRegion(fromArn)) return fromArn.toLowerCase();
  const fromCred = resolveKiroRegion(credentials);
  if (isValidAwsRegion(fromCred)) return fromCred.toLowerCase();
  return KIRO_DEFAULT_REGION;
}

// Process-lifetime cache of resolved profileArns keyed by access token, so we
// only hit ListAvailableProfiles once per token when the stored credential has
// none (typical for IDC/Organization accounts outside us-east-1).
const KIRO_PROFILE_ARN_CACHE = new Map();
const KIRO_MAX_EVENTSTREAM_FRAME_BYTES = 16 * 1024 * 1024;
const KIRO_MAX_EVENTSTREAM_HEADERS_BYTES = 128 * 1024;
const KIRO_POST_STOP_EVENT_TYPES = new Set(["contextUsageEvent", "meteringEvent", "metricsEvent"]);
const KIRO_EVENTSTREAM_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < KIRO_EVENTSTREAM_CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  KIRO_EVENTSTREAM_CRC_TABLE[index] = value >>> 0;
}

function eventStreamCrc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (checksum >>> 8) ^ KIRO_EVENTSTREAM_CRC_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** Well-known regions to probe when the credential region yields no profile. */
const KIRO_PROFILE_FALLBACK_REGIONS = ["us-east-1", "eu-central-1"];

/**
 * Resolve a Kiro/CodeWhisperer profileArn for a bearer token via
 * ListAvailableProfiles, trying the credential's own region first and then the
 * well-known Q Developer regions. The Q Developer profile can live in a
 * different region than the IAM Identity Center that minted the token (e.g. IDC
 * in eu-north-1 but the profile in eu-central-1 — Q Developer is not hosted in
 * every SSO region). Returns the first ARN found (preferring one whose region
 * matches the queried region) or null. Exported for unit testing.
 *
 * @param {string} accessToken Bearer token for CodeWhisperer.
 * @param {string} preferredRegion Credential / SSO region to try first.
 * @param {object} [proxyOptions] Proxy passthrough for proxyAwareFetch.
 * @param {object} [log] Optional logger with debug/info/warn.
 * @param {Function} [fetchImpl] Injected fetch (defaults to proxyAwareFetch).
 * @returns {Promise<string|null>}
 */
export async function resolveKiroProfileArnAcrossRegions(
  accessToken,
  preferredRegion,
  proxyOptions = null,
  log = null,
  fetchImpl = proxyAwareFetch,
  signal = null,
) {
  if (!accessToken) return null;
  const rawCandidates = [...new Set(
    [preferredRegion, ...KIRO_PROFILE_FALLBACK_REGIONS]
      .filter(Boolean)
      .map((region) => typeof region === "string" ? region.trim().toLowerCase() : region),
  )];
  // Trust boundary: providerSpecificData.region is stored from user input and is
  // interpolated into the control-plane host. Drop anything that isn't a valid
  // AWS region id rather than building an arbitrary `q.<x>.amazonaws.com` URL.
  const candidates = rawCandidates.filter(isValidAwsRegion);
  for (const region of candidates) {
    if (signal?.aborted) throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Kiro profile discovery aborted", "AbortError");
    try {
      const response = await fetchImpl(buildKiroProfileEndpoint(region), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
        body: JSON.stringify({ maxResults: 10 }),
        signal,
      }, proxyOptions);
      if (!response?.ok) {
        log?.debug?.("KIRO", `ListAvailableProfiles ${region} → ${response?.status}`);
        try { void response?.body?.cancel?.().catch?.(() => {}); } catch { /* already closed */ }
        continue;
      }
      const data = await response.json().catch(() => null);
      const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
      if (profiles.length === 0) continue;
      const arnOf = (p) => (p?.arn || p?.profileArn || "").trim();
      const match = profiles.find((p) => regionFromProfileArn(arnOf(p)) === region) || profiles[0];
      const arn = arnOf(match);
      if (arn) return arn;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      log?.debug?.("KIRO", `ListAvailableProfiles ${region} error: ${e?.message || e}`);
    }
  }
  return null;
}

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4()
    };

    // API-key auth: the key is stored as accessToken and sent as a bearer token
    // exactly like an OAuth access token, but with an extra `tokentype: API_KEY`
    // header so CodeWhisperer treats it as a long-lived API key rather than an
    // OIDC/social access token. Mirrors the Kiro IDE headless-auth behavior.
    // Enterprise / Microsoft Entra (external_idp) tokens are OAuth access tokens,
    // but CodeWhisperer requires TokenType=EXTERNAL_IDP to bind them to profiles.
    const authMethod = credentials?.providerSpecificData?.authMethod;
    const isApiKey = authMethod === "api_key";
    const isExternalIdp = authMethod === "external_idp";

    const apiKey = credentials?.apiKey || (isApiKey ? credentials?.accessToken : null);
    if (isApiKey && apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["tokentype"] = "API_KEY";
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      if (isExternalIdp) {
        headers["TokenType"] = "EXTERNAL_IDP";
      }
    }

    return headers;
  }

  /**
   * Build the region-correct, auth-aware ordered endpoint list.
   *
   * API-key Kiro connections store a raw CodeWhisperer credential (validated
   * against codewhisperer.us-east-1.amazonaws.com via ListAvailableProfiles).
   * The Kiro IDE gateway (runtime.*.kiro.dev) expects Kiro OIDC/social tokens
   * and rejects an `tokentype: API_KEY` token with 401/403 — which
   * BaseExecutor.execute() returns immediately (only 429 / network errors fall
   * through to the next host). So for api-key auth we must try the *.amazonaws.com
   * CodeWhisperer hosts FIRST, mirroring the Kiro-Go reference fork which never
   * routes api-key traffic through kiro.dev. External IdP enterprise tokens also
   * use the CodeWhisperer surface, with the `TokenType: EXTERNAL_IDP` header.
   * Other OAuth methods keep the default order (kiro.dev first) since their
   * tokens are what that gateway accepts.
   */
  getOrderedBaseUrls(credentials) {
    // Region is derived from ONE source of truth: explicit credential region,
    // then the profileArn's region (authoritative — Q Developer profile can live
    // in a different region than the IAM Identity Center that minted the token),
    // then us-east-1. buildKiroBaseUrls encodes the only real asymmetry (the
    // legacy codewhisperer.* host exists only in us-east-1) as data.
    const region = resolveKiroRuntimeRegion(credentials);
    const baseUrls = buildKiroBaseUrls(region);
    const authMethod = credentials?.providerSpecificData?.authMethod;
    // api_key / external_idp / idc tokens are rejected by the kiro.dev IDE
    // gateway (403 "bearer token invalid") and must hit the CodeWhisperer
    // *.amazonaws.com surface first. For non-default regions we likewise prefer
    // the regional q.<region> data plane (the legacy us-east-1 codewhisperer host
    // does not exist elsewhere); the kiro.dev host stays as a failover. us-east-1
    // OAuth/social keeps kiro.dev-first order.
    const isCodeWhispererSurface =
      authMethod === "api_key" || authMethod === "external_idp" || authMethod === "idc";
    const amazonFirst = isCodeWhispererSurface || region !== KIRO_DEFAULT_REGION;
    if (!amazonFirst) return baseUrls;
    const amazon = [...new Set(baseUrls.filter((u) => u.includes("amazonaws.com")))];
    const others = baseUrls.filter((u) => !u.includes("amazonaws.com"));
    return amazon.length > 0 ? [...amazon, ...others] : baseUrls;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const baseUrls = this.getOrderedBaseUrls(credentials);
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  transformRequest(model, body, stream, credentials) {
    return body;
  }

  /**
   * Kiro execute — delegate to BaseExecutor for endpoint fallback + retry, then
   * transform the binary AWS EventStream into OpenAI-shaped SSE on success.
   *
   * BaseExecutor.execute() walks config.baseUrls (runtime.us-east-1.kiro.dev →
   * codewhisperer → q) advancing to the next host on 429 (shouldRetry) and on
   * network/5xx errors, while tryRetry handles in-place retries per `retry: {429: 2}`.
   * Note: api-key connections reorder these so the *.amazonaws.com hosts come
   * first — see getOrderedBaseUrls/buildUrl above.
   * Note: the baseUrls are alternate surfaces of one regional service, so rotation
   * is edge-level failover — it does not grant fresh 429 quota. Per-account 429
   * spreading is handled upstream by account rotation in sse/handlers/chat.js.
   *
   * Errors are returned untransformed so the upstream handler can read the body,
   * classify the status, and trigger account fallback/cooldown.
   */
  async execute(args) {
    // Kiro/CodeWhisperer rejects IDC/Builder-ID requests lacking a profileArn
    // with 400 "profileArn is required". IDC/Organization logins outside
    // us-east-1 frequently land with no profileArn (AWS SSO OIDC doesn't mint
    // one and there is no shared default outside us-east-1). Resolve it on the
    // real request path so connections self-heal.
    await this.ensureKiroProfileArn(args);
    // Profile discovery is not the quota-bearing runtime request. Allocate a
    // fresh fencing clock immediately before BaseExecutor begins dispatch so a
    // slow discovery cannot make later 429 evidence appear older than it is.
    const result = await super.execute({ ...args, attemptStartedAt: null });
    if (result?.response?.ok) {
      result.response = this.transformEventStreamToSSE(result.response, args.model);
      result.terminalProvenance = "validated";
    }
    return result;
  }

  /**
   * Ensure the outgoing Kiro payload carries a profileArn. The translator sets
   * it from the stored credential; when that is empty (typical for IDC/Org
   * accounts outside us-east-1) we resolve it live via ListAvailableProfiles,
   * trying the credential's own region first and then known Q Developer regions
   * (the profile can live in a different region than the Identity Center). The
   * resolved ARN is written onto BOTH the payload and the credential so
   * getOrderedBaseUrls routes the runtime to the profile's region. Cached per
   * access token. api_key auth is skipped — it must use its own account ARN.
   */
  async ensureKiroProfileArn(args) {
    const { body, credentials, log, proxyOptions = null } = args || {};
    if (!body || typeof body !== "object" || body.profileArn) return;
    const psd = credentials?.providerSpecificData || {};
    if (psd.authMethod === "api_key") return;
    const accessToken = credentials?.accessToken;
    if (!accessToken) return;

    const cached = KIRO_PROFILE_ARN_CACHE.get(accessToken);
    if (cached) {
      body.profileArn = cached;
      if (credentials.providerSpecificData) credentials.providerSpecificData.profileArn = cached;
      return;
    }

    const preferredRegion = isValidAwsRegion(psd.region)
      ? psd.region
      : (regionFromProfileArn(psd.profileArn) || KIRO_DEFAULT_REGION);
    const arn = await resolveKiroProfileArnAcrossRegions(accessToken, preferredRegion, proxyOptions, log, proxyAwareFetch, args?.signal || null);
    if (args?.signal?.aborted) throw args.signal.reason instanceof Error
      ? args.signal.reason
      : new DOMException("Kiro profile discovery aborted", "AbortError");
    if (arn) {
      KIRO_PROFILE_ARN_CACHE.set(accessToken, arn);
      body.profileArn = arn;
      // Stamp the credential so getOrderedBaseUrls routes runtime to the ARN's
      // (profile) region — which may differ from the SSO region.
      if (credentials.providerSpecificData) credentials.providerSpecificData.profileArn = arn;
      log?.info?.("KIRO", `Resolved missing profileArn at request time (region=${regionFromProfileArn(arn) || preferredRegion}): ${arn}`);
    } else {
      log?.warn?.("KIRO", `Could not resolve a profileArn (region=${preferredRegion}). Upstream will reject with 400 "profileArn is required". Confirm Amazon Q Developer Pro is enabled for this IAM Identity Center account.`);
    }
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout
   */
  transformEventStreamToSSE(response, model) {
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const capabilityModel = resolveKiroModel(model).upstream;
    const contextWindow = getCapabilitiesForModel("kiro", capabilityModel).contextWindow || 200000;
    const state = {
      endDetected: false,
      finishEmitted: false,
      rawTerminalSeen: false,
      failureSeen: false,
      hasToolCalls: false,
      hasReasoningContent: false,
      reasoningChunkCount: 0,
      toolCallIndex: 0,
      seenToolIds: new Map(),
      inThinking: false
    };
    const rejectFraming = (controller) => {
      if (state.failureSeen) return;
      state.failureSeen = true;
      buffer = new Uint8Array(0);
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ error: { message: "Kiro returned an invalid EventStream frame", type: "stream_error" } })}\n\n`,
      ));
    };

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        if (state.failureSeen) return;
             // Track output so we can emit a keepalive if this frame yields no chunk.
        const enqueueCountBefore = chunkIndex;
        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // Parse events from buffer
        let iterations = 0;
        const maxIterations = 1000;
        while (buffer.length >= 16 && iterations < maxIterations) {
          iterations++;
          const view = new DataView(buffer.buffer, buffer.byteOffset);
          const totalLength = view.getUint32(0, false);
          const headersLength = view.getUint32(4, false);

          if (
            totalLength < 16
            || totalLength > KIRO_MAX_EVENTSTREAM_FRAME_BYTES
            || headersLength > KIRO_MAX_EVENTSTREAM_HEADERS_BYTES
            || headersLength > totalLength - 16
          ) {
            rejectFraming(controller);
            break;
          }
          if (buffer.length < totalLength) break;

          const eventData = buffer.slice(0, totalLength);
          buffer = buffer.slice(totalLength);

          const event = parseEventFrame(eventData);
          if (!event) {
            rejectFraming(controller);
            break;
          }

          const eventType = event.headers[":event-type"] || "";
          const messageType = event.headers[":message-type"] || "";
          if (messageType === "error" || messageType === "exception" || /(?:Error|Exception)$/.test(eventType)) {
            state.failureSeen = true;
            controller.enqueue(new TextEncoder().encode(
              `data: ${JSON.stringify({ error: { message: "Kiro upstream stream failed", type: "provider_error" } })}\n\n`,
            ));
            continue;
          }
          if (state.rawTerminalSeen && !KIRO_POST_STOP_EVENT_TYPES.has(eventType)) {
            rejectFraming(controller);
            break;
          }

          // Track total content length for token estimation
          if (!state.totalContentLength) state.totalContentLength = 0;
          if (!state.contextUsagePercentage) state.contextUsagePercentage = 0;

          // Handle assistantResponseEvent
          if (eventType === "assistantResponseEvent" && event.payload?.content) {
            let content = event.payload.content;

            // Kiro Claude models can leak <thinking> blocks into the content stream.
            // We strip these literal tags to prevent duplication, as the reasoning 
            // is already routed correctly via reasoningContentEvent.
            if (state.inThinking) {
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const after = content.split("</thinking>").slice(1).join("</thinking>");
                content = after.startsWith("\n") ? after.substring(1) : after;
              } else {
                content = ""; // Drop entirely while inside thinking block
              }
            } else if (content.includes("<thinking>")) {
              state.inThinking = true;
              if (content.includes("</thinking>")) {
                state.inThinking = false;
                const before = content.split("<thinking>")[0];
                const after = content.split("</thinking>").slice(1).join("</thinking>");
                content = before + (after.startsWith("\n") ? after.substring(1) : after);
              } else {
                content = content.split("<thinking>")[0];
              }
            }

            if (!content && state.hasReasoningContent) {
              // If we stripped everything, skip emitting an empty content chunk
              continue;
            }

            state.totalContentLength += content.length;

            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: chunkIndex === 0
                  ? { role: "assistant", content }
                  : { content },
                finish_reason: null
              }]
            };
            chunkIndex++;
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle reasoningContentEvent (Kiro thinking / reasoning)
          // Kiro returns reasoning as a separate event when the request system
          // prompt contains <thinking_mode>enabled</thinking_mode>. Surface it
          // as OpenAI delta.reasoning_content so downstream translators can map
          // it back to Claude thinking blocks / Anthropic reasoning, etc.
          if (eventType === "reasoningContentEvent") {
            const reasoning = event.payload?.reasoningContentEvent || event.payload || {};
            const reasoningText = (typeof reasoning === "string")
              ? reasoning
              : (reasoning.text || reasoning.content || "");
            if (reasoningText) {
              state.hasReasoningContent = true;
              state.totalContentLength += reasoningText.length;

              const reasoningDelta = state.reasoningChunkCount === 0 && chunkIndex === 0
                ? { role: "assistant", reasoning_content: reasoningText }
                : { reasoning_content: reasoningText };

              const chunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{
                  index: 0,
                  delta: reasoningDelta,
                  finish_reason: null
                }]
              };
              chunkIndex++;
              state.reasoningChunkCount++;
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          }

          // Handle codeEvent
          if (eventType === "codeEvent" && event.payload?.content) {
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: event.payload.content },
                finish_reason: null
              }]
            };
            chunkIndex++;
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }

          // Handle toolUseEvent
          if (eventType === "toolUseEvent" && event.payload) {
            state.hasToolCalls = true;
            const toolUse = event.payload;
            const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

            for (const singleToolUse of toolUses) {
              const toolCallId = singleToolUse.toolUseId || `call_${Date.now()}`;
              const toolName = singleToolUse.name || "";
              const toolInput = singleToolUse.input;

              let toolIndex;
              const isNewTool = !state.seenToolIds.has(toolCallId);

              if (isNewTool) {
                toolIndex = state.toolCallIndex++;
                state.seenToolIds.set(toolCallId, toolIndex);

                const startChunk = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: {
                      ...(chunkIndex === 0 ? { role: "assistant" } : {}),
                      tool_calls: [{
                        index: toolIndex,
                        id: toolCallId,
                        type: "function",
                        function: {
                          name: toolName,
                          arguments: ""
                        }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                chunkIndex++;
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(startChunk)}\n\n`));
              } else {
                toolIndex = state.seenToolIds.get(toolCallId);
              }

              if (toolInput !== undefined) {
                let argumentsStr;

                if (typeof toolInput === 'string') {
                  argumentsStr = toolInput;
                } else if (typeof toolInput === 'object') {
                  argumentsStr = JSON.stringify(toolInput);
                } else {
                  continue;
                }

                const argsChunk = {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: toolIndex,
                        function: {
                          arguments: argumentsStr
                        }
                      }]
                    },
                    finish_reason: null
                  }]
                };
                chunkIndex++;
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(argsChunk)}\n\n`));
              }
            }
          }

          // Handle messageStopEvent
          if (eventType === "messageStopEvent") {
            state.rawTerminalSeen = true;
          }

          // Handle contextUsageEvent to extract contextUsagePercentage
          if (eventType === "contextUsageEvent" && event.payload?.contextUsagePercentage) {
            state.contextUsagePercentage = event.payload.contextUsagePercentage;
            // Mark that we received context usage event
            state.hasContextUsage = true;
          }

          // Handle meteringEvent - mark that we received it
          if (eventType === "meteringEvent") {
            state.hasMeteringEvent = true;
          }

          // Handle metricsEvent for token usage
          if (eventType === "metricsEvent") {
            // Extract usage data from metricsEvent payload
            const metrics = event.payload?.metricsEvent || event.payload;
            if (metrics && typeof metrics === 'object') {
              const inputTokens = metrics.inputTokens || 0;
              const outputTokens = metrics.outputTokens || 0;
              // ponytail: Amazon Q upstream does not expose cache fields today,
              // but pick up cache_read_input_tokens / cache_creation_input_tokens
              // if the event shape grows them so cost tracking stays accurate.
              const cachedTokens = metrics.cacheReadInputTokens || metrics.cache_read_input_tokens || 0;
              const cacheCreationInputTokens = metrics.cacheCreationInputTokens || metrics.cache_creation_input_tokens || 0;

              if (inputTokens > 0 || outputTokens > 0) {
                state.usage = {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens
                };
                // Kiro is Claude-backed: inputTokens EXCLUDES cache (Claude convention),
                // not inclusive like OpenAI's cached_tokens. Emit cache_read_input_tokens
                // (not cached_tokens) so canonicalizeUsage takes the Claude fold path and
                // correctly adds cache back into prompt_tokens instead of undercharging.
                if (cachedTokens > 0) state.usage.cache_read_input_tokens = cachedTokens;
                if (cacheCreationInputTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationInputTokens;
              }
            }
          }

          // Emit final chunk only after receiving BOTH meteringEvent AND contextUsageEvent
          if (state.rawTerminalSeen && state.hasMeteringEvent && state.hasContextUsage && !state.finishEmitted) {
            state.finishEmitted = true;

            // Estimate tokens if not available from events
            if (!state.usage) {
              // Estimate output tokens from content length
              const estimatedOutputTokens = state.totalContentLength > 0
                ? Math.max(1, Math.floor(state.totalContentLength / 4))
                : 0;

              // Estimate input tokens from contextUsagePercentage
              const estimatedInputTokens = state.contextUsagePercentage > 0
                ? Math.floor(state.contextUsagePercentage * contextWindow / 100)
                : 0;

              state.usage = {
                prompt_tokens: estimatedInputTokens,
                completion_tokens: estimatedOutputTokens,
                total_tokens: estimatedInputTokens + estimatedOutputTokens
              };
            }

            const finishChunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: state.hasToolCalls ? "tool_calls" : "stop"
              }]
            };

            // Include usage in final chunk if available
            if (state.usage) {
              finishChunk.usage = state.usage;
            }

            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          }
        }

        if (iterations >= maxIterations) {
          console.warn("[Kiro] Max iterations reached in event parsing");
        }

        // No client chunk produced this frame — emit an SSE comment keepalive
                // so the stall watchdog sees upstream activity (ignored by parser/client).
                if (chunkIndex === enqueueCountBefore && !state.finishEmitted && !state.failureSeen) {
                  controller.enqueue(new TextEncoder().encode(": ka\n\n"));
                }
      },

      flush(controller) {
        if (buffer.length > 0) {
          state.failureSeen = true;
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ error: { message: "Kiro stream ended with a truncated EventStream frame", type: "stream_error" } })}\n\n`,
          ));
        } else if (!state.rawTerminalSeen && !state.failureSeen) {
          state.failureSeen = true;
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ error: { message: "Kiro stream ended before messageStopEvent", type: "stream_error" } })}\n\n`,
          ));
        }

        // Emit finish only for a raw application terminal, never arbitrary EOF.
        if (state.rawTerminalSeen && !state.failureSeen && !state.finishEmitted) {
          state.finishEmitted = true;
          if (!state.usage && state.totalContentLength > 0) {
            const completionTokens = Math.max(1, Math.floor(state.totalContentLength / 4));
            const promptTokens = state.contextUsagePercentage > 0
              ? Math.floor(state.contextUsagePercentage * contextWindow / 100)
              : 0;
            state.usage = {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            };
          }
          const finishChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: state.hasToolCalls ? "tool_calls" : "stop"
              }]
          };
          if (state.usage) finishChunk.usage = state.usage;
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
        }

        if (state.rawTerminalSeen && !state.failureSeen) {
          controller.enqueue(new TextEncoder().encode(SSE_DONE));
        }
      }
    });

    // Pipe response body through transform stream
    if (!response.body) {
      return new Response(JSON.stringify({ error: { message: "Kiro upstream returned no response body" } }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const transformedStream = response.body.pipeThrough(transformStream);

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions
      );

      return result;
    } catch (error) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data) {
  try {
    if (!(data instanceof Uint8Array) || data.byteLength < 16) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (
      totalLength !== data.byteLength
      || headersLength > KIRO_MAX_EVENTSTREAM_HEADERS_BYTES
      || headersLength > totalLength - 16
    ) return null;
    if (view.getUint32(8, false) !== eventStreamCrc32(data.subarray(0, 8))) return null;
    if (
      view.getUint32(totalLength - 4, false)
      !== eventStreamCrc32(data.subarray(0, totalLength - 4))
    ) return null;

    const headers = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;
    const decoder = new TextDecoder("utf-8", { fatal: true });

    while (offset < headerEnd) {
      const nameLen = data[offset];
      offset++;
      if (nameLen === 0 || offset + nameLen + 1 > headerEnd) return null;

      const name = decoder.decode(data.subarray(offset, offset + nameLen));
      offset += nameLen;
      if (Object.prototype.hasOwnProperty.call(headers, name)) return null;

      const headerType = data[offset];
      offset++;
      // Kiro's application headers are strings. Reject unknown encodings rather
      // than partially accepting a frame with ambiguous header boundaries.
      if (headerType !== 7 || offset + 2 > headerEnd) return null;
      const valueLen = view.getUint16(offset, false);
      offset += 2;
      if (offset + valueLen > headerEnd) return null;
      headers[name] = decoder.decode(data.subarray(offset, offset + valueLen));
      offset += valueLen;
    }
    if (offset !== headerEnd) return null;

    const payloadStart = headerEnd;
    const payloadEnd = data.length - 4; // Exclude message CRC

    let payload = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = decoder.decode(data.subarray(payloadStart, payloadEnd));

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }
      payload = JSON.parse(payloadStr);
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

export default KiroExecutor;
