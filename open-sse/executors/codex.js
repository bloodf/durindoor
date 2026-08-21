import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput, normalizeStatelessResponseInput } from "../translator/formats/responsesApi.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { resolveOpenAiEffort } from "../translator/concerns/thinkingUnified.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import {
  CODEX_SSE_PEEK_TIMEOUT_MS,
  DEFAULT_RETRY_CONFIG,
  HTTP_STATUS,
  resolveRetryEntry,
} from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import {
  applyCodexClientIdentityHeaders,
  applyCodexClientMetadata,
  applyCodexOriginalIdentityHeaders,
  withCodexFingerprintCredentials,
} from "../config/codexIdentity.js";
import { applyCodexAccountHeader } from "../shared/codexAccountId.js";
import { settleProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { extractCompleteSseFrames } from "../utils/streamHelpers.js";
import { cancelAndReleaseReader, releaseReader } from "../utils/streamReader.js";

// Recognized Codex effort suffixes, lowest-to-highest. Single source of truth for
// routing normalization: transformRequest strips the suffix from the wire id.
const CODEX_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/**
 * Split a Codex model id into its bare upstream id and recognized effort suffix.
 * e.g. `gpt-5.5-xhigh` → `{ model: "gpt-5.5", effort: "xhigh" }`;
 * `gpt-5.5` → `{ model: "gpt-5.5", effort: null }`. A trailing segment not in
 * CODEX_EFFORT_LEVELS is part of the model id, not an effort.
 *
 * @param {unknown} modelId Candidate model id.
 * @returns {{model: string, effort: string|null}} Bare id and effort (null when absent/unrecognized).
 */
function splitCodexEffortSuffix(modelId) {
  const model = typeof modelId === "string" ? modelId : "";
  for (const level of CODEX_EFFORT_LEVELS) {
    if (model.endsWith(`-${level}`)) {
      return { model: model.slice(0, -`-${level}`.length), effort: level };
    }
  }
  return { model, effort: null };
}

// SSE error patterns inside 200-OK bodies. Some retry same account first; capacity rotates accounts.
const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_CONTEXT_OVERFLOW_PATTERNS = [
  "exceeds the context window",
  "maximum context length",
  "context_length_exceeded",
];
const CODEX_SSE_FAILURE_EVENTS = new Set(["error", "failed", "response.failed"]);

const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_EVENTS = new Set([
  "response.output_text.delta",
  "response.function_call_arguments.delta",
]);
const CODEX_SSE_PEEK_BYTES = 256 * 1024;
const CODEX_MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";
// Codex sometimes disguises an overload as a successful output_text stream (#3232).
const CODEX_OVERLOADED_OUTPUT_MESSAGE = "Our servers are currently overloaded. Please try again later.";
const CODEX_PRIORITY_SHORT_CONTEXT_LIMIT = 272_000;
const CODEX_PRIORITY_ESTIMATED_INPUT_LIMIT = 256_000;
const CODEX_TOKEN_PART_PATTERN = /[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g;

// Responses Lite transport: official codex CLI exec subagents send this opt-in
// header plus a slim metadata envelope. Forward the contract verbatim only when
// the client opted in, scoped to the immutable request-local context so
// concurrent requests never leak headers across shared credentials.
const CODEX_RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const CODEX_LITE_METADATA_HEADERS = [
  "openai-beta",
  "x-client-request-id",
  "x-codex-beta-features",
  "x-codex-installation-id",
  "x-codex-parent-thread-id",
  "x-codex-turn-metadata",
  "x-codex-turn-state",
  "x-codex-window-id",
  "x-openai-memgen-request",
  "x-openai-subagent",
  "x-responsesapi-include-timing-metrics",
];
// Apply Codex transport-level effort aliases after model-aware semantic resolution.
// Official openai/codex serializes semantic Ultra as Max for requests; other efforts identity-map.
// Upstream provenance: decolua/9router#2523 — aliases are matched case-sensitively (no
// toLowerCase), so an unknown uppercase effort (e.g. "ULTRA") is never promoted to a wire alias.
function resolveCodexWireEffort(effort, config) {
  const aliases = config?.quirks?.reasoningEffortAliases;
  if (!aliases || effort == null) return effort;
  return aliases[effort] ?? effort;
}

function estimateCodexInputTokens(body, stopAt = Number.POSITIVE_INFINITY) {
  let json;
  try {
    json = JSON.stringify(body);
  } catch {
    return 0;
  }

  // ponytail: Codex sends no input-token count; replace this lexical estimate when one becomes available.
  let tokens = 0;
  for (const match of json.matchAll(CODEX_TOKEN_PART_PATTERN)) {
    const part = match[0];
    tokens += /^[A-Za-z0-9_\s]/.test(part) ? Math.ceil(part.length / 4) : 1;
    if (tokens >= stopAt) return tokens;
  }
  return tokens;
}

const CODEX_LITE_METADATA_MAX_BYTES = 16_384;
const CODEX_LITE_USER_AGENT_RE = /^codex(?:_cli_rs|_exec|-cli)\//i;
const CODEX_LITE_ORIGINATOR_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Whether the inbound request opted into the Codex Responses Lite transport.
 * The client sets the `x-openai-internal-codex-responses-lite` header to the
 * literal string `"true"`; the comparison is case-insensitive and tolerates
 * surrounding whitespace. Missing header or any other value means "off".
 *
 * @param {object} [requestContext] Immutable per-request context carrying `clientHeaders`.
 * @returns {boolean} `true` when Responses Lite is explicitly requested.
 */
function usesResponsesLite(requestContext) {
  const value = requestContext?.clientHeaders?.[CODEX_RESPONSES_LITE_HEADER];
  return String(value || "").trim().toLowerCase() === "true";
}

/**
 * Forward the Responses Lite allowlist onto an outbound `headers` object.
 * No-op unless {@link usesResponsesLite} is true for the request, so the
 * lite transport never leaks onto ordinary requests. Copies the marker header,
 * allowlisted metadata headers (skipped when absent, non-string, or over the
 * length cap), and forwards the Codex CLI `User-Agent` / `originator` only when
 * they match the expected shapes. Mutates `headers` in place.
 *
 * @param {Record<string, string>} headers Destination headers object to populate.
 * @param {object} [requestContext] Immutable per-request context carrying `clientHeaders`.
 * @returns {void}
 */
function copyResponsesLiteHeaders(headers, requestContext) {
  if (!usesResponsesLite(requestContext)) return;
  const clientHeaders = requestContext?.clientHeaders || {};
  headers[CODEX_RESPONSES_LITE_HEADER] = "true";

  for (const name of CODEX_LITE_METADATA_HEADERS) {
    const value = clientHeaders[name];
    if (typeof value === "string" && value && value.length <= CODEX_LITE_METADATA_MAX_BYTES) {
      headers[name] = value;
    }
  }

  const userAgent = clientHeaders["user-agent"];
  if (typeof userAgent === "string" && CODEX_LITE_USER_AGENT_RE.test(userAgent)) {
    headers["User-Agent"] = userAgent;
  }

  const originator = clientHeaders.originator;
  if (typeof originator === "string" && CODEX_LITE_ORIGINATOR_RE.test(originator)) {
    headers.originator = originator;
  }
}

// Compact (/responses/compact) uses a unary JSON contract — narrower allowlist,
// no stream/store/include fields — distinct from streaming Responses.
const COMPACT_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "parallel_tool_calls", "reasoning",
  "service_tier", "prompt_cache_key", "text"
]);

/**
 * Canonicalize an SSE event name for case-insensitive comparison.
 * Non-string inputs collapse to the empty string rather than throwing.
 *
 * @param {unknown} value Raw `event` field (or payload `type`/`event`) value.
 * @returns {string} Trimmed, lowercased name, or `""` for non-strings.
 */
function normalizeEventName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Recognize explicit error event names.
 * Matches the bare `error` event and any name ending with `.error`
 * (e.g. `response.error`).
 *
 * @param {unknown} value Candidate event name (raw `event`/`type` field).
 * @returns {boolean} `true` when the value names an explicit error event.
 */
function isExplicitErrorEvent(value) {
  const name = normalizeEventName(value);
  return name === "error" || name.endsWith(".error");
}

/**
 * Return the first `patterns` entry that appears as a substring of any value.
 * Comparison is case-insensitive; `values` are coerced to strings so `null` /
 * `undefined` entries simply never match. Used to classify an SSE error frame
 * as retryable vs account-rotating from a list of message substrings.
 *
 * @param {unknown[]} values Candidate strings to search (e.g. error messages).
 * @param {string[]} patterns Lowercased substrings to look for, in priority order.
 * @returns {string|null} The matching pattern, or `null` when none match.
 */
function firstPattern(values, patterns) {
  const lowered = values.map((value) => String(value || "").toLowerCase());
  return patterns.find((pattern) => lowered.some((value) => value.includes(pattern))) || null;
}

/**
 * Parse and classify one complete SSE frame, including terminal Codex context
 * overflow failures from decolua/9router#3386. Incomplete data never reaches
 * this seam; {@link extractCompleteSseFrames} retains it as a remainder.
 */
function classifyCodexSseFrame(frame) {
  let eventName = "";
  const dataLines = [];
  for (const rawLine of String(frame || "").split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = normalizeEventName(value);
    if (field === "data") dataLines.push(value);
  }

  const data = dataLines.join("\n");
  let payload = null;
  if (data && data !== "[DONE]") {
    try { payload = JSON.parse(data); } catch { /* explicit text error events are handled below */ }
  }

  const payloadType = normalizeEventName(payload?.type);
  const payloadEvent = normalizeEventName(payload?.event);
  const userOutput = CODEX_SSE_USER_OUTPUT_EVENTS.has(eventName)
    || CODEX_SSE_USER_OUTPUT_EVENTS.has(payloadType)
    || CODEX_SSE_USER_OUTPUT_EVENTS.has(payloadEvent);
  if (userOutput) {
    const isOutputTextDelta = eventName === "response.output_text.delta"
      || payloadType === "response.output_text.delta"
      || payloadEvent === "response.output_text.delta";
    const delta = isOutputTextDelta && typeof payload?.delta === "string" ? payload.delta : null;
    return { userOutput: true, kind: null, matched: null, message: null, delta };
  }

  const errorObjects = [payload?.error, payload?.response?.error]
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const responseStatus = normalizeEventName(payload?.response?.status);
  const failureEvent = CODEX_SSE_FAILURE_EVENTS.has(eventName)
    || CODEX_SSE_FAILURE_EVENTS.has(payloadType)
    || CODEX_SSE_FAILURE_EVENTS.has(payloadEvent)
    || CODEX_SSE_FAILURE_EVENTS.has(responseStatus);
  const explicitError = failureEvent
    || isExplicitErrorEvent(payloadType)
    || isExplicitErrorEvent(payloadEvent)
    || errorObjects.length > 0;
  if (!explicitError) return { userOutput: false, kind: null, matched: null, message: null };

  const values = [];
  for (const error of errorObjects) {
    values.push(error.code, error.type, error.message);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    values.push(payload.code, payload.type, payload.message);
  } else if (eventName === "error") {
    values.push(data);
  }

  const message = errorObjects.find((error) => typeof error.message === "string")?.message
    || (typeof payload?.message === "string" ? payload.message : null)
    || (eventName === "error" && data ? data : null);
  const contextMatch = (failureEvent || errorObjects.length > 0)
    && firstPattern(values, CODEX_SSE_CONTEXT_OVERFLOW_PATTERNS);
  if (contextMatch) return { userOutput: false, kind: "context", matched: contextMatch, message };

  const accountMatch = firstPattern(values, CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS);
  if (accountMatch) return { userOutput: false, kind: "account", matched: accountMatch, message };

  const retryMatch = firstPattern(values, CODEX_SSE_RETRY_PATTERNS);
  if (retryMatch) return { userOutput: false, kind: "retry", matched: retryMatch, message };
  return { userOutput: false, kind: null, matched: null, message };
}


// Hosted tool types that Codex/OpenAI Responses executes server-side
const CODEX_HOSTED_TOOL_TYPES = new Set([
  "image_generation", "web_search", "web_search_preview", "file_search",
  "computer", "computer_use_preview", "code_interpreter", "mcp", "local_shell",
  "tool_search"
]);

// Responses-native freeform tools carry a name plus format payload and must pass through intact.
const CODEX_PASSTHROUGH_TOOL_TYPES = new Set(["custom"]);

// Allowlist of fields accepted by Codex Responses API — anything else is stripped
const RESPONSES_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "stream", "store",
  "reasoning", "service_tier", "include", "prompt_cache_key", "client_metadata",
  "text"
]);

// Convert role=system → role=developer in body.input (keeps content in cacheable prefix)
function convertSystemToDeveloperRole(body) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const isSystemMsg = item.role === "system" && (!item.type || item.type === "message");
    if (isSystemMsg) item.role = "developer";
  }
}

// Assistant history in the Responses API must use `output_text` (or `refusal`),
// never `input_text` (which is user-only). codex-cli replays assistant turns as
// `input_text` (or legacy `text`); normalize them so the Codex/OpenAI backend
// accepts the replay. Applies to every Codex model id (bare or prefixed) — the
// wire contract is model-agnostic. User and function items are untouched.
// Upstream provenance: diegosouzapw/OmniRoute#6932.
function normalizeCodexAssistantHistory(body) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.role !== "assistant" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      if (part.type === "input_text" || part.type === "text") {
        part.type = "output_text";
        delete part.annotations;
        delete part.logprobs;
        delete part.obfuscation;
      }
    }
  }
}


// Flatten Chat-Completions tool shape into Responses flat format + filter unsupported tools
function normalizeCodexTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";
    if (type === "namespace") {
      if (Array.isArray(tool.tools)) {
        for (const st of tool.tools) {
          const n = typeof st?.name === "string" ? st.name.trim().slice(0, 128) : "";
          if (n) validNames.add(n);
        }
      }
      return true;
    }
    if (type !== "function") {
      if (CODEX_PASSTHROUGH_TOOL_TYPES.has(type)) return true;
      if (!type || tool.function || typeof tool.name === "string") return false;
      return CODEX_HOSTED_TOOL_TYPES.has(type);
    }
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    const parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(name);
    return true;
  });
  // Drop tool_choice if it references an unknown function name
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Resolve prompt-cache session id: client session → assistant-text-hash → workspaceId → connection
function resolveCacheSessionId(body, credentials, requestContext = null) {
  return resolveSessionId({
    headers: requestContext?.clientHeaders || credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "codex"
  });
}

function cloneRequestBody(body) {
  if (!body || typeof body !== "object") return body;
  return structuredClone(body);
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function waitForRetry(delayMs, signal) {
  throwIfAborted(signal);
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(abortReason(signal));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}


function peekTimeoutError() {
  const error = new Error("Codex SSE prefix timeout");
  error.name = "TimeoutError";
  return error;
}

async function readBeforeDeadline(reader, { signal = null, deadlineAt }) {
  throwIfAborted(signal);
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw peekTimeoutError();
  let timer = null;
  let onAbort = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(peekTimeoutError()), remaining);
        if (signal) {
          onAbort = () => reject(abortReason(signal));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener?.("abort", onAbort);
  }
}

/** Replay consumed bytes under backpressure, then continue the same reader. */
function createReplayBody(reader, chunks, terminalError = null) {
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    releaseReader(reader);
  };

  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (terminalError) {
        finish();
        controller.error(terminalError);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      try { await reader.cancel(reason); } finally { releaseReader(reader); }
    },
  });
}

// Codex sometimes rejects a request whose historical reasoning item carries an
// `encrypted_content` blob it can no longer verify (cache/account boundary),
// returning 400 invalid_encrypted_content. Detect that exact failure so the
// executor can retry ONCE with the bad encrypted reasoning stripped (#2667).
async function isInvalidEncryptedContentResponse(response) {
  if (response?.status !== HTTP_STATUS.BAD_REQUEST || typeof response.clone !== "function") return false;
  try {
    const payload = JSON.parse(await response.clone().text());
    const error = payload?.error || payload;
    if (error?.code === "invalid_encrypted_content") return true;
    const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    return message.includes("encrypted content") &&
      (message.includes("could not be verified") || message.includes("could not be decrypted or parsed"));
  } catch {
    return false;
  }
}

// Drop the unverifiable encrypted_content from reasoning items; keep the item
// only when it still carries a usable summary/content, else remove it entirely.
function removeInvalidEncryptedReasoning(body) {
  if (!Array.isArray(body?.input)) return 0;
  let removed = 0;
  body.input = body.input.filter((item) => {
    if (!item || item.type !== "reasoning" || !Object.hasOwn(item, "encrypted_content")) return true;
    delete item.encrypted_content;
    removed++;
    const hasSummary = Array.isArray(item.summary) ? item.summary.length > 0 : Boolean(item.summary);
    const hasContent = Array.isArray(item.content) ? item.content.length > 0 : Boolean(item.content);
    return hasSummary || hasContent;
  });
  return removed;
}

// Report the *effective* service tier — the transformed body may have been
// normalized (fast→priority) or stripped entirely for long contexts, so the
// tier the client requested is not necessarily what upstream received (#3316).
export function formatCodexTierLog(model, transformedBody) {
  const effectiveTier = transformedBody?.service_tier || "default";
  return `CODEX | ${model} | TIER:${effectiveTier}`;
}

function codexSseErrorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status === HTTP_STATUS.PAYLOAD_TOO_LARGE
        ? "context_length_exceeded"
        : status === HTTP_STATUS.SERVICE_UNAVAILABLE ? "service_unavailable" : "upstream_error",
    }
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
  }

  /**
   * Add Codex identity headers from immutable request-local context.
   */
  buildHeaders(credentials, stream = true, requestContext = null) {
    const headers = super.buildHeaders(credentials, stream);
    headers["session_id"] = requestContext?.sessionId || credentials?.connectionId || "default";
    // Identify client type to Codex backend (matches official codex CLI)
    if (!headers["originator"]) headers["originator"] = "codex_cli_rs";
    // Responses Lite transport: forward the opt-in header + slim metadata
    // envelope from the immutable request context (never from shared credentials).
    copyResponsesLiteHeaders(headers, requestContext);
    // are configured. OAuth import stores ChatGPT account ID as chatgptAccountId;
    // older/custom rows may use workspaceId/accountId. Prefer explicit workspaceId
    // but fall back to chatgptAccountId/accountId so requests don't cross-bind to
    // the wrong OpenAI account and surface as token_invalid after adding another account.
    applyCodexAccountHeader(headers, credentials?.providerSpecificData, "ChatGPT-Account-ID", credentials?.idToken);
    // Converge Codex OAuth requests onto an account-scoped identity so the caller's
    // own client identity does not leak upstream; respects codexFingerprintMode.
    const identity = credentials?.providerSpecificData?.codexClientIdentity;
    if (identity) {
      applyCodexClientIdentityHeaders(headers, identity);
    } else {
      const original = credentials?.providerSpecificData?.codexOriginalIdentityHeaders;
      if (original) applyCodexOriginalIdentityHeaders(headers, original);
    }
    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null, requestContext = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return requestContext?.compact ? `${base}/compact` : base;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("codex", credentials, log, proxyOptions);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("codex", credentials);
  }

  /**
   * Prefetch remote image URLs and inline them as base64 data URIs.
   * Runs before execute() because Codex backend cannot fetch remote images.
   * Mutates body.input in place.
   */
  async prefetchImages(body) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (c) => {
        if (c.type !== "image_url") return c;
        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
        const detail = c.image_url?.detail || "auto";
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args) {
    const requestBody = cloneRequestBody(args.body) || {};
    const legacyCompact = requestBody?._compact === true;
    delete requestBody._compact;
    const requestContext = Object.freeze({
      ...(args.requestContext || {}),
      compact: args.requestContext?.compact === true || legacyCompact,
      sessionId: args.requestContext?.sessionId
        || resolveCacheSessionId(requestBody, args.credentials, args.requestContext),
    });
    const credentials = withCodexFingerprintCredentials(
      args.credentials,
      requestContext.clientHeaders,
      requestContext.compact ? "/compact" : null,
    );

    const imgCount = Array.isArray(requestBody.input) ? requestBody.input.reduce((n, it) => n + (Array.isArray(it.content) ? it.content.filter(c => c.type === "image_url").length : 0), 0) : 0;
    const inputLen = Array.isArray(requestBody.input) ? requestBody.input.length : 0;
    dbg("CODEX", `execute start | inputItems=${inputLen} | images=${imgCount}`);
    if (imgCount > 0) {
      const t0 = Date.now();
      await this.prefetchImages(requestBody);
      dbg("CODEX", `prefetchImages done | ${Date.now() - t0}ms`);
    } else {
      await this.prefetchImages(requestBody);
    }

    // Reuses 503 retry config — same semantic: upstream temporarily unavailable.
    // Each attempt receives a fresh body because BaseExecutor transforms in place.
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[HTTP_STATUS.SERVICE_UNAVAILABLE]);
    let attempt = 0;
    let encryptedRecoveryAttempted = false;
    let tierLogged = false;
    while (true) {
      throwIfAborted(args.signal);
      const result = await super.execute({
        ...args,
        credentials,
        body: cloneRequestBody(requestBody),
        requestContext,
      });
      // Surface the effective tier once per request (#3316).
      if (!tierLogged) {
        args.log?.info?.("TIER", formatCodexTierLog(args.model, result.transformedBody));
        tierLogged = true;
      }
      // One-shot recovery: on a 400 invalid_encrypted_content, strip the
      // unverifiable encrypted reasoning and retry the SAME account once (#2667).
      if (!encryptedRecoveryAttempted && await isInvalidEncryptedContentResponse(result.response)) {
        const removed = removeInvalidEncryptedReasoning(requestBody);
        if (removed > 0) {
          encryptedRecoveryAttempted = true;
          args.log?.warn?.("RETRY", `CODEX | invalid encrypted reasoning; retrying same account without ${removed} encrypted item(s)`);
          continue;
        }
      }
      let peek;
      try {
        peek = await this._peekSseTransientError(result.response, args.signal);
      } catch (error) {
        const reason = error?.name === "AbortError"
          ? "abort"
          : error?.name === "TimeoutError" ? "timeout" : "stream_error";
        await settleProviderAttemptDispatch(result.response, { success: false, reason });
        throw error;
      }
      if (!peek.matched) {
        // Replace body with re-assembled stream (prefix bytes already read + rest)
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      if (peek.contextOverflow) {
        args.log?.warn?.("CODEX", `SSE context overflow "${peek.message}"`);
        await settleProviderAttemptDispatch(result.response, { success: false, reason: "upstream_error" });
        result.response = codexSseErrorResponse(
          HTTP_STATUS.PAYLOAD_TOO_LARGE,
          peek.message || peek.matched,
        );
        return result;
      }
      if (peek.accountFallback) {
        args.log?.warn?.("RETRY", `CODEX | SSE account fallback "${peek.message}"`);
        await settleProviderAttemptDispatch(result.response, { success: false, reason: "upstream_error" });
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || CODEX_MODEL_CAPACITY_MESSAGE);
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.("RETRY", `CODEX | SSE overloaded "${peek.matched}" — retries exhausted (${attempt}/${attempts})`);
        await settleProviderAttemptDispatch(result.response, { success: false, reason: "upstream_error" });
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || peek.matched);
        return result;
      }
      attempt++;
      args.log?.debug?.("RETRY", `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`);
      dbg("CODEX", `SSE overloaded "${peek.matched}" → retry ${attempt}/${attempts} in ${delayMs}ms`);
      await settleProviderAttemptDispatch(result.response, { success: false, reason: "fallback" });
      await waitForRetry(delayMs, args.signal);
    }
  }

  /**
   * Inspect complete SSE frames within a bounded byte prefix. Context overflow
   * failures are terminal (#3386); non-matches replay byte-for-byte through a
   * stream retaining the original reader.
   */
  async _peekSseTransientError(response, signal = null) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, contextOverflow: false, replacementBody: null };
    const reader = response.body.getReader();
    const deadlineAt = Date.now() + CODEX_SSE_PEEK_TIMEOUT_MS;
    const decoder = new TextDecoder();
    const chunks = [];
    let buffer = "";
    let inspectedBytes = 0;
    let classification = null;
    let terminalError = null;
    // Codex sometimes disguises an overload as a successful output_text stream (#3232).
    let outputDeltaAccumulator = "";

    while (inspectedBytes < CODEX_SSE_PEEK_BYTES) {
      let read;
      try {
        read = await readBeforeDeadline(reader, { signal, deadlineAt });
      } catch (error) {
        if (error?.name === "AbortError" || error?.name === "TimeoutError") {
          await cancelAndReleaseReader(reader, error.name);
          throw error;
        }
        terminalError = error;
        dbg("CODEX", `peek read error: ${error.message}`);
        break;
      }
      if (read.done) break;

      const value = read.value;
      chunks.push(value);
      const remainingBytes = CODEX_SSE_PEEK_BYTES - inspectedBytes;
      const inspectable = value.byteLength > remainingBytes
        ? value.subarray(0, remainingBytes)
        : value;
      inspectedBytes += inspectable.byteLength;
      buffer += decoder.decode(inspectable, { stream: true });

      const batch = extractCompleteSseFrames(buffer);
      buffer = batch.remainder;
      let sawOutputInBatch = false;
      for (const frame of batch.frames) {
        const frameResult = classifyCodexSseFrame(frame);
        if (frameResult.userOutput) {
          if (typeof frameResult.delta === "string") outputDeltaAccumulator += frameResult.delta;
          else sawOutputInBatch = true;
        }
        if (frameResult.kind === "context") classification = frameResult;
        else if (frameResult.kind === "account" && classification?.kind !== "context") classification = frameResult;
        else if (frameResult.kind === "retry" && !["context", "account"].includes(classification?.kind)) classification = frameResult;
      }

      if (classification) break;
      if (sawOutputInBatch) break;
      if (outputDeltaAccumulator) {
        const normalizedOutput = outputDeltaAccumulator.toLowerCase();
        const normalizedOverload = CODEX_OVERLOADED_OUTPUT_MESSAGE.toLowerCase();
        // Keep peeking only while accumulated output is still an exact prefix of the
        // known overload message; an answer that quotes and continues past it must
        // not be misclassified as an outage.
        if (!normalizedOverload.startsWith(normalizedOutput)) break;
      }
      if (inspectedBytes >= CODEX_SSE_PEEK_BYTES) break;
    }

    // #3232: full-match overload detection after the loop terminates.
    if (classification?.kind !== "context"
        && outputDeltaAccumulator
        && outputDeltaAccumulator.toLowerCase() === CODEX_OVERLOADED_OUTPUT_MESSAGE.toLowerCase()) {
      await cancelAndReleaseReader(reader, "codex-sse-retry");
      return {
        matched: "codex_overloaded_output",
        message: CODEX_OVERLOADED_OUTPUT_MESSAGE,
        accountFallback: false,
        contextOverflow: false,
        replacementBody: null,
      };
    }

    if (classification) {
      await cancelAndReleaseReader(reader, "codex-sse-retry");
      return {
        matched: classification.matched,
        message: classification.message || classification.matched,
        accountFallback: classification.kind === "account",
        contextOverflow: classification.kind === "context",
        replacementBody: null,
      };
    }

    return {
      matched: null,
      message: null,
      accountFallback: false,
      contextOverflow: false,
      replacementBody: createReplayBody(reader, chunks, terminalError),
    };
  }

  // Parse Codex usage_limit_reached to extract precise resetsAtMs; fallback to default otherwise
  parseError(response, bodyText) {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (!resetsAtMs && typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch { /* fall through to default */ }
    }
    return super.parseError(response, bodyText);
  }

  /**
   * Transform request before sending - inject default instructions if missing.
   * Image fetching is handled separately in prefetchImages() so this stays sync.
   */
  transformRequest(model, body, stream, credentials, requestContext = null) {
    delete body._compact;
    const isCompact = requestContext?.compact === true;
    const responsesLite = usesResponsesLite(requestContext);
    // Resolve conversation-stable session_id (priority: body → assistant-text → workspace → machine)
    const sessionId = requestContext?.sessionId || resolveCacheSessionId(body, credentials, requestContext);
    // Convert string input to array format (Codex API requires input as array)
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    // Ensure input is present and non-empty (Codex API rejects empty input)
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    // Keep system prompts in body.input as role=developer so they stay in the cacheable prefix
    convertSystemToDeveloperRole(body);
    // Rewrite replayed assistant history input_text/text parts → output_text (#6932)
    normalizeCodexAssistantHistory(body);
    // Remove replay-only call item IDs and stored references that store=false cannot resolve.
    body.input = normalizeStatelessResponseInput(body.input);
    // Apply Codex OAuth fingerprint identity to body.client_metadata (post-allowlist).
    const bodyIdentity = credentials?.providerSpecificData?.codexClientIdentity;
    if (bodyIdentity) applyCodexClientMetadata(body, bodyIdentity);
    // Flatten function tools + drop unsupported types
    normalizeCodexTools(body);

    // Ensure streaming is enabled (Codex API requires it); /responses/compact is unary JSON.
    if (isCompact) delete body.stream;
    else body.stream = true;

    // If no instructions provided, inject default Codex instructions.
    // Responses Lite / compact carry instructions inside body.input (developer
    // message); injecting the default top-level string would duplicate it.
    if (!responsesLite && !isCompact && (typeof body.instructions !== "string" || body.instructions.trim() === "")) {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    } else if (responsesLite && body.instructions === "") {
      delete body.instructions;
    }

    // Ensure store is false (Codex requirement); compact has no store field.
    if (isCompact) delete body.store;
    else body.store = false;

    // Inject prompt_cache_key for stable Codex prompt caching
    if (!body.prompt_cache_key && sessionId) {
      body.prompt_cache_key = sessionId;
    }

    // Map virtual Codex review models to the upstream Codex model before suffix parsing.
    body.model = getModelUpstreamId("cx", body.model || model);

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high → high, gpt-5.3-codex → low (default)
    const effortSplit = splitCodexEffortSuffix(body.model);
    const modelEffort = effortSplit.effort;
    if (modelEffort) {
      // Strip suffix from model name for actual API call
      body.model = effortSplit.model;
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (low)
    // resolveOpenAiEffort keeps model-aware semantic support; resolveCodexWireEffort maps Ultra→Max for wire.
    if (!body.reasoning) {
      const semantic = resolveOpenAiEffort(body.reasoning_effort || modelEffort || 'low', "codex", body.model);
      const effort = resolveCodexWireEffort(semantic, this.config);
      body.reasoning = { effort, summary: "auto" };
    } else {
      const semantic = resolveOpenAiEffort(body.reasoning.effort, "codex", body.model);
      body.reasoning.effort = resolveCodexWireEffort(semantic, this.config);
      if (!body.reasoning.summary) body.reasoning.summary = "auto";
    }
    delete body.reasoning_effort;

    // Include reasoning encrypted content (required by Codex backend for reasoning models);
    // compact requests omit the include field entirely.
    if (!isCompact && body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
    } else if (isCompact) {
      delete body.include;
    }

    // Remove unsupported parameters for Codex API
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.max_output_tokens; // Responses API clients send this but Codex rejects it
    delete body.user; // Cursor sends this but Codex doesn't support it
    delete body.prompt_cache_retention; // Cursor sends this but Codex doesn't support it
    delete body.metadata; // Cursor sends this but Codex doesn't support it
    delete body.stream_options; // Cursor sends this but Codex doesn't support it
    delete body.safety_identifier; // Droid CLI sends this but Codex doesn't support it
    delete body.previous_response_id; // store=false → backend can't resolve previous resp; avoid 404

    if (body.service_tier === "fast") body.service_tier = "priority";
    if (body.service_tier === "priority" && /^gpt-/.test(body.model)) {
      const estimatedInputTokens = estimateCodexInputTokens(body, CODEX_PRIORITY_ESTIMATED_INPUT_LIMIT);
      if (estimatedInputTokens >= CODEX_PRIORITY_ESTIMATED_INPUT_LIMIT) {
        delete body.service_tier;
        console.log(
          `[Codex] Priority disabled for long context | estimated_input>=${CODEX_PRIORITY_ESTIMATED_INPUT_LIMIT} | short_limit=${CODEX_PRIORITY_SHORT_CONTEXT_LIMIT}`,
        );
      }
    }
    if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;

    // Final allowlist filter — compact and streaming Responses use different contracts.
    const allowlist = isCompact ? COMPACT_API_ALLOWLIST : RESPONSES_API_ALLOWLIST;
    for (const k of Object.keys(body)) {
      if (!allowlist.has(k)) delete body[k];
    }

    return body;
  }
}
