import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { applyCodexAccountHeader } from "../shared/codexAccountId.js";

// SSE error patterns inside 200-OK bodies. Some retry same account first; capacity rotates accounts.
const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];

const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_EVENTS = new Set([
  "response.output_text.delta",
  "response.function_call_arguments.delta",
]);
const CODEX_SSE_PEEK_BYTES = 256 * 1024;
const CODEX_MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";

function extractCompleteSseFrames(buffer) {
  const frames = [];
  const delimiter = /\r?\n\r?\n/g;
  let cursor = 0;
  let match;
  while ((match = delimiter.exec(buffer)) !== null) {
    frames.push(buffer.slice(cursor, match.index));
    cursor = delimiter.lastIndex;
  }
  return { frames, remainder: buffer.slice(cursor) };
}

function normalizeEventName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isExplicitErrorEvent(value) {
  const name = normalizeEventName(value);
  return name === "error" || name.endsWith(".error");
}

function firstPattern(values, patterns) {
  const lowered = values.map((value) => String(value || "").toLowerCase());
  return patterns.find((pattern) => lowered.some((value) => value.includes(pattern))) || null;
}

/** Parse and classify one complete SSE frame; incomplete data is never inspected. */
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
  if (userOutput) return { userOutput: true, kind: null, matched: null, message: null };

  const errorObjects = [payload?.error, payload?.response?.error]
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const explicitError = eventName === "error"
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

  const accountMatch = firstPattern(values, CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS);
  const message = errorObjects.find((error) => typeof error.message === "string")?.message
    || (typeof payload?.message === "string" ? payload.message : null)
    || (eventName === "error" && data ? data : null);
  if (accountMatch) return { userOutput: false, kind: "account", matched: accountMatch, message };

  const retryMatch = firstPattern(values, CODEX_SSE_RETRY_PATTERNS);
  if (retryMatch) return { userOutput: false, kind: "retry", matched: retryMatch, message };
  return { userOutput: false, kind: null, matched: null, message };
}

// Server-generated item id prefixes that Codex /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

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
  "model", "input", "instructions", "tools", "tool_choice", "stream", "store",
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

// Strip server-generated item IDs (rs_/fc_/resp_/msg_) from input — avoids 404 with store=false
function stripStoredItemReferences(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (typeof item.id === "string" && SERVER_ID_PATTERN.test(item.id)) delete item.id;
    }
    return true;
  });
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

function normalizeReasoningEffort(value) {
  return value === "max" ? "xhigh" : value;
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

function releaseReader(reader) {
  try { reader.releaseLock(); } catch { /* already released */ }
}

async function cancelAndReleaseReader(reader, reason) {
  try { await reader.cancel(reason); } catch { /* cancellation is best-effort */ }
  finally { releaseReader(reader); }
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

function codexSseErrorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status === HTTP_STATUS.SERVICE_UNAVAILABLE ? "service_unavailable" : "upstream_error",
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
    // Account/workspace binding header — required when multiple Codex accounts
    // are configured. OAuth import stores ChatGPT account ID as chatgptAccountId;
    // older/custom rows may use workspaceId/accountId. Prefer explicit workspaceId
    // but fall back to chatgptAccountId/accountId so requests don't cross-bind to
    // the wrong OpenAI account and surface as token_invalid after adding another account.
    applyCodexAccountHeader(headers, credentials?.providerSpecificData);
    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null, requestContext = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return requestContext?.compact ? `${base}/compact` : base;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("codex", credentials, log);
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

    // Retry loop for SSE-level overloaded errors (200 OK body contains event: error)
    // Reuses 503 retry config — same semantic: upstream temporarily unavailable.
    // Each attempt receives a fresh body because BaseExecutor transforms in place.
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    while (true) {
      throwIfAborted(args.signal);
      const result = await super.execute({
        ...args,
        body: cloneRequestBody(requestBody),
        requestContext,
      });
      const peek = await this._peekSseTransientError(result.response);
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
      if (peek.accountFallback) {
        args.log?.warn?.("RETRY", `CODEX | SSE account fallback "${peek.message}"`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || CODEX_MODEL_CAPACITY_MESSAGE);
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.("RETRY", `CODEX | SSE overloaded "${peek.matched}" — retries exhausted (${attempt}/${attempts})`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || peek.matched);
        return result;
      }
      attempt++;
      args.log?.debug?.("RETRY", `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`);
      dbg("CODEX", `SSE overloaded "${peek.matched}" → retry ${attempt}/${attempts} in ${delayMs}ms`);
      await waitForRetry(delayMs, args.signal);
    }
  }

  /**
   * Inspect complete SSE frames within a bounded byte prefix. Non-matches are
   * replayed byte-for-byte through a stream that retains the original reader.
   */
  async _peekSseTransientError(response) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let buffer = "";
    let inspectedBytes = 0;
    let classification = null;
    let terminalError = null;

    while (inspectedBytes < CODEX_SSE_PEEK_BYTES) {
      let read;
      try {
        read = await reader.read();
      } catch (error) {
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
        if (frameResult.userOutput) sawOutputInBatch = true;
        if (frameResult.kind === "account") classification = frameResult;
        else if (frameResult.kind === "retry" && classification?.kind !== "account") classification = frameResult;
      }

      if (classification) break;
      if (sawOutputInBatch) break;
      if (inspectedBytes >= CODEX_SSE_PEEK_BYTES) break;
    }

    if (classification) {
      await cancelAndReleaseReader(reader, "codex-sse-retry");
      return {
        matched: classification.matched,
        message: classification.message || classification.matched,
        accountFallback: classification.kind === "account",
        replacementBody: null,
      };
    }

    return {
      matched: null,
      message: null,
      accountFallback: false,
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
    // Strip server-generated item IDs (rs_/fc_/resp_/msg_) — Codex /responses can't resolve when store=false
    stripStoredItemReferences(body);
    // Flatten function tools + drop unsupported types
    normalizeCodexTools(body);

    // Ensure streaming is enabled (Codex API requires it)
    body.stream = true;

    // If no instructions provided, inject default Codex instructions
    if (!body.instructions || body.instructions.trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    // Ensure store is false (Codex requirement)
    body.store = false;

    // Inject prompt_cache_key for stable Codex prompt caching
    if (!body.prompt_cache_key && sessionId) {
      body.prompt_cache_key = sessionId;
    }

    // Map virtual Codex review models to the upstream Codex model before suffix parsing.
    body.model = getModelUpstreamId("cx", body.model || model);

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high → high, gpt-5.3-codex → medium (default)
    const effortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (body.model.endsWith(`-${level}`)) {
        modelEffort = level;
        // Strip suffix from model name for actual API call
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (medium)
    if (!body.reasoning) {
      const effort = normalizeReasoningEffort(body.reasoning_effort || modelEffort || 'low');
      body.reasoning = { effort, summary: "auto" };
    } else {
      body.reasoning.effort = normalizeReasoningEffort(body.reasoning.effort);
      if (!body.reasoning.summary) body.reasoning.summary = "auto";
    }
    delete body.reasoning_effort;

    // Include reasoning encrypted content (required by Codex backend for reasoning models)
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
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
    if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;

    // Final allowlist filter — strip any unknown field that could trigger upstream "routing_unsupported"
    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }
}
