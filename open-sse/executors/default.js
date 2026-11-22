import crypto from "crypto";
import { normalizeStrictChatHistory } from "../utils/strictChatHistory.js";
import { normalizeNvidiaToolCallIds } from "../translator/concerns/toolCall.js";
import { BaseExecutor, normalizeAnthropicHeaders } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH, resolveHerokuBaseUrl } from "../config/providers.js";
import { PROVIDER_DEFAULTS } from "../providers/schema.js";
import { resolveProviderAlias } from "../services/model.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE, selectAnthropicBeta, mergeForwardableClientBetas, buildClaudeOAuthAnthropicBeta, withoutClaudeCodeIdentityBetas } from "../providers/shared.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders, buildKimiDeviceHeaders, NOUS_ATTRIBUTION, CLAUDE_SYSTEM_PROMPT } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { applyDeepSeekV4ProAlias, injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getOpenAICompatibleType } from "../services/provider.js";
import { refreshOpenferenceToken } from "../services/openferenceAuth.js";
import { refreshCodebuddyToken } from "../services/tokenRefresh.js";
import { refreshKimiToken } from "../services/tokenRefresh/providers.js";
import { isOfficialAnthropicBaseUrl } from "../utils/anthropicHost.js";
import { stripUnsupportedChatExtensions, stripUnsupportedParams, applyParamRenames } from "../translator/concerns/paramSupport.js";
import { FORMATS } from "../translator/formats.js";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";
import { isNumber, isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
// Official API keys must not identify as Claude Code; OAuth and gateways retain their own identity.
function isOfficialAnthropicApiKey(provider, credentials) {
  if (provider !== "anthropic" && !provider?.startsWith("anthropic-compatible-")) return false;
  if (!isString(credentials?.apiKey) || !credentials.apiKey || credentials.accessToken || credentials.apiKey.startsWith("sk-ant-oat")) return false;
  const url = credentials.runtimeTransport?.baseUrl || (provider === "anthropic" ? ANTHROPIC_COMPAT_BASE : credentials.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE);
  return isOfficialAnthropicBaseUrl(url);
}

function stripClaudeIdentity(body) {
  const strip = (text) => {
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
    const prefix = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r?\n$/, "");
      if (line === CLAUDE_SYSTEM_PROMPT) continue;
      if (/^x-anthropic-billing-header:/i.test(line)) prefix.push(lines[i]);
      else return prefix.join("") + lines.slice(i).join("");
    }
    return prefix.join("");
  };
  let system = body?.system;
  if (isString(system)) system = strip(system);
  else if (Array.isArray(system)) {
    const parts = [];
    let leading = true;
    for (const block of system) {
      if (!leading || block?.type !== CLAUDE_BLOCK.TEXT || !isString(block.text) || !block.text) {
        parts.push(block);
        leading = false;
        continue;
      }
      const text = strip(block.text);
      if (!text) continue;
      parts.push(text === block.text ? block : { ...block, text });
      leading = /^x-anthropic-billing-header:[^\n]*(?:\r?\n)?$/i.test(text);
    }
    if (parts.length === system.length && parts.every((block, index) => block === system[index])) return body;
    system = parts;
  } else return body;
  if (system === body.system) return body;
  const result = { ...body };
  if (system === "" || (Array.isArray(system) && !system.length)) delete result.system;
  else result.system = system;
  return result;
}

// Opt-in prompt-cache key injection for openai-compatible providers.
// OpenAI-style upstreams (Chat Completions + Responses) accept an optional
// `prompt_cache_key` routing hint that pins a conversation to a cache shard,
// the same mechanism the Codex executor uses. We do NOT enable it by default:
// some strict openai-compatible gateways reject unknown fields. A custom
// provider opts in via providerSpecificData.enablePromptCacheKey === true.
// Client-supplied keys pass only when selected transport advertises
// `transport.quirks.preservePromptCacheKey`; final wire guard below shares this
// configured seam and never replaces opaque client values (decolua/9router#3733).
export function normalizePromptCacheKey(provider, sessionId) {
  if (!sessionId) return "";
  const scoped = `${provider || "openai-compatible"}:${sessionId}`;
  return `cc_${crypto.createHash("sha256").update(scoped).digest("hex").slice(0, 32)}`;
}

/**
 * Derive OpenCode Go affinity solely from fork-resolved session identity.
 * Caller-supplied x-opencode-session headers never reach this input.
 */
export function openCodeGoSessionHeader(credentials, body = null) {
  const sessionId = resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "opencode-go",
  });
  return `ses_${crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

export function injectPromptCacheKey(provider, body, credentials) {
  if (!body || !isObject(body)) return body;
  if (credentials?.providerSpecificData?.enablePromptCacheKey !== true) return body;
  if (isString(body.prompt_cache_key) && body.prompt_cache_key) return body;

  // translateRequest() already captured a conversation-stable id into
  // credentials._clientSessionId; fall back to resolving one here so this
  // also works on the same-format fast path (openai→openai) where capture
  // may not have run. The upstream key is a short provider-scoped hash rather
  // than a raw client/session identifier, keeping it stable but provider-safe.
  const sessionId = credentials?._clientSessionId || resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: provider
  });

  const promptCacheKey = normalizePromptCacheKey(provider, sessionId);
  if (promptCacheKey) body.prompt_cache_key = promptCacheKey;
  return body;
}

export function injectOpenAIStore(body, provider, credentials, transportFormat) {
  if (!body || !isObject(body)) return body;
  if (provider !== "openai" && !provider?.startsWith("openai-compatible-responses-")) return body;
  if (credentials?.providerSpecificData?.openaiStoreEnabled !== true) return body;
  if (transportFormat !== FORMATS.OPENAI_RESPONSES && transportFormat !== FORMATS.OPENAI_RESPONSE) return body;
  body.store = true;
  return body;
}

export const OPENAI_TOOL_CALL_ID_MAX_LENGTH = 64;
export const OPENAI_TOOL_CALL_ID_PREFIX_LENGTH = 20;

// OpenAI Chat Completions rejects tool-call IDs longer than 64 characters.
// Normalize each distinct overlong ID once per request so assistant calls and
// their tool results always keep the same relationship. A full SHA-256 digest
// keeps IDs collision-resistant even when their retained prefixes are equal.
// Source: decolua/9router#3167.
export function normalizeOpenAIToolCallIds(body) {
  if (!Array.isArray(body?.messages)) return body;

  const normalizedIds = new Map();
  const normalize = (id) => {
    if (!isString(id) || id.length <= OPENAI_TOOL_CALL_ID_MAX_LENGTH) return id;
    if (normalizedIds.has(id)) return normalizedIds.get(id);

    const prefix = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, OPENAI_TOOL_CALL_ID_PREFIX_LENGTH) || "call";
    const digest = crypto.createHash("sha256").update(id).digest("base64url");
    const normalized = `${prefix}_${digest}`;
    normalizedIds.set(id, normalized);
    return normalized;
  };

  for (const message of body.messages) {
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall && Object.hasOwn(toolCall, "id")) toolCall.id = normalize(toolCall.id);
      }
    }
    if (message?.role === "tool" && Object.hasOwn(message, "tool_call_id")) {
      message.tool_call_id = normalize(message.tool_call_id);
    }
  }

  return body;
}

// OpenAI's automatic prompt cache covers `input` (+ tools) but not the top-level
// Responses `instructions` field, so a stateless Responses request re-bills its
// system prompt every turn. Move non-empty string `instructions` to the front of
// `input` as a developer message. Stateful continuations (previous_response_id /
// conversation) and Chat Completions bodies (`messages`) are left untouched.
// Source: OmniRoute #20854 (issue #20846).
function hasResponsesContinuation(body) {
  const prev = body.previous_response_id;
  if (isString(prev) ? prev.trim().length > 0 : prev !== undefined && prev !== null) return true;
  const conversation = body.conversation;
  return isString(conversation) ? conversation.trim().length > 0 : isRecord(conversation);
}

function responsesInputItems(input) {
  if (Array.isArray(input)) return input;
  if (isString(input)) {
    return input.length > 0 ? [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }] : [];
  }
  return isRecord(input) ? [input] : [];
}

export function hoistOpenAIResponsesInstructionsToInput(body) {
  if (!isRecord(body) || Array.isArray(body.messages)) return body;
  if (hasResponsesContinuation(body)) return body;
  if (!isString(body.instructions) || body.instructions.trim().length === 0) return body;

  const { instructions, ...rest } = body;
  return {
    ...rest,
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: instructions }] },
      ...responsesInputItems(body.input)
    ]
  };
}

// Auth header descriptors — derived from registry transport.auth, fallback to hardcoded defaults.
const BEARER = { combined: true, header: "Authorization", scheme: "bearer" };
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" };
const AUTH_DESCRIPTORS = Object.fromEntries(
  Object.entries(PROVIDERS).
  filter(([, t]) => t.auth).
  map(([id, t]) => [id, t.auth])
);

// Apply a token to a header per scheme. Missing tokens intentionally leave the
// header absent so optional local providers do not send "Bearer undefined".


export function normalizeAccountIdPlaceholder(provider, accountId) {
  const trimmed = `${accountId || ""}`.trim();
  if (!trimmed) throw new Error(`${provider} requires accountId in providerSpecificData`);
  // Snowflake documents a "dashed" hostname variant of the account identifier:
  // underscores are valid in the account name but not in a DNS label, so
  // normalize them to hyphens before validation/URL construction.
  const normalized = trimmed.replace(/_/g, "-");

  const labels = normalized.split(".");
  const validDnsLabels = labels.every((label) =>
  label.length > 0 &&
  label.length <= 63 &&
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
  );
  if (!validDnsLabels || normalized.length > 253) {
    throw new Error(`${provider} requires a valid accountId in providerSpecificData`);
  }

  return normalized;
}

// Apply a token to a header per scheme (matches legacy: combined always sets, even when undefined).
function setAuth(headers, spec, token) {
  if (!token) return;
  const scheme = spec.scheme;
  if (scheme === "bearer") headers[spec.header] = `Bearer ${token}`;else
  if (scheme === "key") headers[spec.header] = `Key ${token}`;else
  if (spec.prefix) headers[spec.header] = `${spec.prefix} ${token}`;else
  headers[spec.header] = token;
}

// Header names are case-insensitive; preserve a configured version exactly once.
function ensureAnthropicVersion(headers) {
  const keys = Object.keys(headers).filter((key) => key.toLowerCase() === "anthropic-version");
  const value = headers["anthropic-version"] ?? headers[keys[0]] ?? ANTHROPIC_API_VERSION;
  for (const key of keys) delete headers[key];
  headers["anthropic-version"] = value;
}

// Resolve auth onto headers from a descriptor.
function applyAuth(headers, desc, credentials) {
  if (desc.combined) {
    setAuth(headers, desc, credentials.apiKey || credentials.accessToken);
    applyExtraHeaders(headers, desc.extraHeaders, credentials);
    if (desc.anthropicVersion) ensureAnthropicVersion(headers);
    return;
  }
  // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);else
  if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  applyExtraHeaders(headers, desc.extraHeaders, credentials);
  if (desc.anthropicVersion) ensureAnthropicVersion(headers);
}

function applyExtraHeaders(headers, extraHeaders, credentials) {
  if (!Array.isArray(extraHeaders)) return;
  for (const spec of extraHeaders) {
    if (!spec?.header || !spec?.from) continue;
    const value = credentials?.[spec.from];
    if (value) headers[spec.header] = value;
  }
}

// Provider-specific header quirks kept as small hooks (not pure auth).
const HEADER_HOOKS = {
  // CodeBuddy: the gateway's channel check rejects requests lacking the plugin's
  // conversation/request identifiers with 400 / 11128 "request illegal".
  codebuddyHeaders: (h) => {
    const requestId = crypto.randomUUID();
    h["X-Request-ID"] = requestId;
    h["X-Conversation-ID"] = crypto.randomUUID();
    h["X-Conversation-Request-ID"] = requestId;
    h["X-Conversation-Message-ID"] = requestId;
  },
  kimiHeaders: (h, c) => {
    const deviceId = c.providerSpecificData?.deviceId;
    Object.assign(h, deviceId ? buildKimiDeviceHeaders(deviceId) : buildKimiHeaders());
  },
  kimiDeviceHeaders: (h, c) => {
    const deviceId = c.providerSpecificData?.deviceId;
    if (deviceId) Object.assign(h, buildKimiDeviceHeaders(deviceId));
  },
  clineHeaders: (h, c) => Object.assign(h, buildClineHeaders(c.apiKey || c.accessToken)),
  kilocodeOrg: (h, c) => {if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId;},
  claudeOverlay: (h) => {
    const cached = getCachedClaudeHeaders();
    if (!cached) return;
    for (const lcKey of Object.keys(cached)) {
      const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
      if (lcKey === "anthropic-beta") {
        const staticBetaStr = h[titleKey] || h[lcKey] || "";
        const flags = new Set(staticBetaStr.split(",").map((f) => f.trim()).filter(Boolean));
        for (const f of cached[lcKey].split(",").map((f) => f.trim()).filter(Boolean)) flags.add(f);
        cached[lcKey] = Array.from(flags).join(",");
      }
      if (titleKey !== lcKey && h[titleKey] !== undefined) delete h[titleKey];
    }
    Object.assign(h, cached);
  }
};

// Config-driven OAuth refresh grants — derived from registry oauth.refresh.
const REFRESH_GRANTS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH).
  filter(([, o]) => o.refresh).
  map(([id, o]) => {
    const tokenUrl = o.tokenUrl;
    const encoding = o.refresh.encoding;
    const extraParams = o.refresh.scope ? { scope: o.refresh.scope } : {};
    // Provider-declared refresh headers (e.g. the OAuth-only Anthropic beta
    // the Claude grant needs). Kept in the registry so the dedicated refresher
    // and this generic grant send the same wire contract.
    const extraHeaders = o.refresh.headers || null;
    return [id, {
      encoding,
      headers: extraHeaders,
      url: () => tokenUrl,
      params: (ex) => id === "gemini" ?
      { client_id: ex.config.clientId, client_secret: ex.config.clientSecret, ...extraParams } :
      { client_id: o.clientId, ...extraParams }
    }];
  })
);

// OmniRoute local/self-hosted parity: these provider IDs are configurable
// OpenAI-compatible endpoints. When no connection baseUrl is set, stay on the
// provider's local default instead of falling back through PROVIDERS.openai.
export const LOCAL_PROVIDER_DEFAULT_BASE_URLS = {
  "lm-studio": "http://localhost:1234/v1",
  vllm: "http://localhost:8000/v1",
  lemonade: "http://localhost:13305/api/v1",
  llamafile: "http://127.0.0.1:8080/v1",
  "llama-cpp": "http://127.0.0.1:8080/v1",
  mlx: "http://127.0.0.1:8080/v1",
  triton: "http://localhost:8000/v1",
  "docker-model-runner": "http://localhost:12434/v1",
  xinference: "http://localhost:9997/v1",
  oobabooga: "http://localhost:5000/v1",
  "9router": "http://127.0.0.1:20130/v1"
};


const GLMT_MODEL_ALIASES = {
  "glm-5.2-high": { model: "glm-5.2", reasoningEffort: "high" },
  "glm-5.2-max": { model: "glm-5.2", reasoningEffort: "max" }
};

function applyGlmtModelAlias(provider, model, body) {
  if (provider !== "glmt" || !body || !isObject(body)) return body;
  const alias = GLMT_MODEL_ALIASES[model] || GLMT_MODEL_ALIASES[body.model];
  if (!alias) return body;
  body.model = alias.model;
  body.reasoning_effort = alias.reasoningEffort;
  return body;
}

// Floor for clinepass thinking models so reasoning does not consume the entire
// output budget and return finish_reason:"length" with empty content (#2332).
export const THINKING_BUDGET_FLOOR = 4096;

// Fill a missing/non-positive budget, but preserve positive client values.
// The output cap limits default insertion only.
export function computeThinkingBudget(current, cap) {
  const maxOutput = isNumber(cap) && cap > 0 ? cap : THINKING_BUDGET_FLOOR;
  const target = Math.min(THINKING_BUDGET_FLOOR, maxOutput);
  if (!isNumber(current) || current <= 0) return target;
  return null;
}

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    const providerId = resolveProviderAlias(provider);
    // Dynamic nodes resolve their endpoint from credentials, never another vendor.
    super(providerId, PROVIDERS[providerId] || { ...PROVIDER_DEFAULTS });
  }

  applyRequestDefaults(body) {
    const defaults = this.config?.requestDefaults;
    if (!defaults || !body || !isObject(body)) return body;
    if (defaults.maxTokens !== undefined && body.max_tokens === undefined && body.max_completion_tokens === undefined) {
      body.max_tokens = defaults.maxTokens;
    }
    if (defaults.temperature !== undefined && body.temperature === undefined) {
      body.temperature = defaults.temperature;
    }
    if (defaults.thinkingBudgetTokens !== undefined || defaults.thinkingType !== undefined) {
      const current = body.thinking && isObject(body.thinking) ? body.thinking : {};
      body.thinking = {
        ...current,
        ...(current.type === undefined && defaults.thinkingType !== undefined ? { type: defaults.thinkingType } : null),
        ...(current.budget_tokens === undefined && defaults.thinkingBudgetTokens !== undefined ? { budget_tokens: defaults.thinkingBudgetTokens } : null)
      };
    }
    return body;
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    this.applyRequestDefaults(body);
    // Provider-specific request hook (e.g. SenseNova Token Plan clamps
    // max_tokens / max_completion_tokens above its 65536 ceiling).
    // The hook may return a new body (non-mutating hooks) or the same one.
    const clamped = this.config?.clampRequestBody?.(body);
    if (clamped && isObject(clamped) && !Array.isArray(clamped)) body = clamped;
    applyGlmtModelAlias(this.provider, model, body);
    let transformed = this.applyJsonSchemaFallback(this.applyNousAttribution(model, body, stream, credentials));

    if (isOfficialAnthropicApiKey(this.provider, credentials)) transformed = stripClaudeIdentity(transformed);

    const transportFormat = credentials?.runtimeTransport?.format?.replace(/-apikey$/, "") || this.config.format;
    transformed = applyDeepSeekV4ProAlias({
      provider: this.provider,
      model: requestContext?.catalogModel || model,
      body: transformed,
      transportFormat
    });


    if (transformed && isObject(transformed)) {
      // Cohere compatibility accepts only high when a reasoning effort is supplied.
      if (this.provider === "cohere" && isString(transformed.reasoning_effort)) {
        transformed.reasoning_effort = "high";
      }
      // The official OpenAI transport is force-streamed even for JSON clients.
      // Keep the actual upstream body aligned with the executor's resolved mode;
      // chat core converts the SSE response back to JSON for those clients.
      if (this.provider === "openai" && stream === true) {
        const clientRequestedStreaming = transformed.stream === true;
        transformed.stream = true;
        if (!clientRequestedStreaming) {
          transformed.stream_options = {
            ...transformed.stream_options,
            include_usage: true
          };
        }
      }
      // quirk: some openai-compatible providers reject Anthropic's client_metadata field
      if (this.config.quirks?.dropClientMetadata || (this.provider.startsWith("openai-compatible-") && getOpenAICompatibleType(this.provider, credentials) === "chat")) {
        delete transformed.client_metadata;
      }
      this.defaultResponsesTextFormat(transformed);
      // Ask OpenAI-compatible upstreams to include usage in the final stream
      // chunk so /v1 streaming requests record real token counts instead of
      // IN 0 · OUT 0 (decolua/9router#3081, port of #3017 fix). Use the resolved
      // runtime transport: multi-endpoint providers may select Claude even when
      // their registry default is OpenAI, and Anthropic rejects stream_options.
      if (transportFormat === "openai" && stream === true && transformed.messages && !transformed.stream_options) {
        transformed.stream_options = { include_usage: true };
      }
      if (this.provider === "openai") {
        normalizeOpenAIToolCallIds(transformed);
        transformed = hoistOpenAIResponsesInstructionsToInput(transformed);
      }
      // NVIDIA rejects the long opaque tool-call IDs other providers mint.
      if (this.provider === "nvidia") {
        normalizeNvidiaToolCallIds(transformed);
      }
      if (this.config.format === "openai" && stream === false) {
        // Resolved stream mode is authoritative for upstream OpenAI-compatible
        // payloads, including providers that explicitly reject streaming.
        // Also drop stream_options: it's only meaningful with stream:true
        // (include_usage controls the final SSE usage chunk) and some
        // OpenAI-compatible upstreams 400 on stream_options when stream is false
        // (client sent it because it originally requested streaming).
        transformed.stream = false;
        delete transformed.stream_options;
      }
      if (this.provider === "opencode-go" && credentials) {
        credentials._openCodeGoSession = openCodeGoSessionHeader(credentials, transformed);
        // buildHeaders() never sees the body; record whether the Claude lane carries
        // context_management so the paired beta flag can travel with it (#4876).
        credentials._openCodeGoContextManagement = Boolean(transformed.context_management);
      }
      if (this.provider?.startsWith("openai-compatible-") &&
        !this.provider.startsWith("openai-compatible-responses-") &&
        transportFormat === FORMATS.OPENAI && credentials?.providerSpecificData?.strictChatHistory === true &&
        Array.isArray(transformed.messages)) {
        transformed.messages = normalizeStrictChatHistory(transformed.messages);
      }
      injectPromptCacheKey(this.provider, transformed, credentials);
      injectOpenAIStore(transformed, this.provider, credentials, transportFormat);
      stripUnsupportedChatExtensions(transformed, credentials?.runtimeTransport, this.config);
      // Messages always uses max_tokens, independently of OpenAI model-name rules.
      if (this.provider === "kimi" && transportFormat === FORMATS.OPENAI) {
        // Moonshot Chat uses max_completion_tokens and fixed sampling on these models.
        if (transformed.max_tokens !== undefined) {
          transformed.max_completion_tokens ??= transformed.max_tokens;
          delete transformed.max_tokens;
        }
        if (/^kimi-k(?:2\.6|2\.7-code(?:-highspeed)?|3(?:\.1-pro(?:-highspeed)?)?)$/i.test(model)) {
          for (const param of ["temperature", "top_p", "frequency_penalty", "presence_penalty", "n"]) delete transformed[param];
        }
      } else if (transportFormat === FORMATS.CLAUDE) {
        if (transformed.max_completion_tokens !== undefined) {
          transformed.max_tokens ??= transformed.max_completion_tokens;
          delete transformed.max_completion_tokens;
        }
      } else {
        applyParamRenames(this.provider, model, transformed, requestContext?.modelCapabilities);
      }
      stripUnsupportedParams(this.provider, model, transformed, requestContext?.modelCapabilities, undefined, credentials);
      // Luna Chat Completions rejects function tools with reasoning enabled.
      if (this.provider === "openai" && model === "gpt-5.6-luna" &&
        transportFormat === FORMATS.OPENAI && ![FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE].includes(requestContext?.sourceFormat) &&
        Array.isArray(transformed.tools) && transformed.tools.some((tool) => tool?.type === "function")) {
        transformed.reasoning_effort = "none";
      }
      // Native DeepSeek V4 rejects forced tool calls while thinking is enabled.
      const deepseekModel = String(model || "").split("/").pop();
      const thinking = transformed.thinking;
      const thinkingEnabled = isRecord(thinking) ?
        thinking.type !== "disabled" : String(transformed.reasoning_effort || "").trim().toLowerCase() !== "none";
      const choice = transformed.tool_choice;
      const forcedChoice = choice === "required" || choice === "any" ||
        isRecord(choice) &&
        ["any", "tool", "function"].includes(String(choice.type || "").toLowerCase());
      if (this.provider === "deepseek" && transportFormat === FORMATS.OPENAI &&
        /^deepseek-(?:v4|flash)(?:[._-]|$)/i.test(deepseekModel) && thinkingEnabled && forcedChoice) {
        delete transformed.tool_choice;
      }
      /**
       * Convert the translator's Chat-compatible reasoning field only at the
       * final Responses wire boundary. Keeping this out of translateRequest
       * preserves its flat intermediate contract and avoids double nesting.
       */
      if (
      transportFormat === FORMATS.OPENAI_RESPONSES ||
      transportFormat === FORMATS.OPENAI_RESPONSE)
      {
        if (isString(transformed.reasoning_effort)) {
          const priorReasoning = transformed.reasoning && isObject(
            transformed.reasoning) &&
          !Array.isArray(transformed.reasoning) ?
          transformed.reasoning :
          null;
          transformed.reasoning = {
            summary: "auto",
            ...priorReasoning,
            effort: transformed.reasoning_effort
          };
          delete transformed.reasoning_effort;
        }
      }
    }

    // reasoning_content is an OpenAI-compatibility field. Anthropic Messages
    // transports carry thinking blocks natively and may reject this extra key,
    // so skip the injection when the resolved transport speaks Claude (#2705).
    // Compare the normalized wire format: runtime transports may carry an
    // auth suffix such as "claude-apikey", which still means Messages.
    if (credentials?.runtimeTransport?.format?.replace(/-(?:apikey|oauth)$/, "") === FORMATS.CLAUDE) {
      return this.ensureThinkingBudget(transformed, model, requestContext?.modelCapabilities);
    }
    const injected = injectReasoningContent({ provider: this.provider, model, body: transformed });
    // Model-wide injection must not reintroduce fields rejected by Mistral.
    if (this.provider === "mistral") stripUnsupportedParams(this.provider, model, injected, requestContext?.modelCapabilities, undefined, credentials);
    return this.ensureThinkingBudget(injected, model, requestContext?.modelCapabilities);
  }

  // ClinePass / OpenRouter-style thinking models burn all of max_tokens on reasoning
  // when the budget is too small, leaving content empty (finish_reason: "length").
  // Bump max_tokens to a safe minimum only when reasoning is enabled and budget undersized.
  // Source: decolua/9router#2332 @ 005d970f49.
  ensureThinkingBudget(body, model, modelCapabilities = null) {
    if (!body || this.provider !== "clinepass") return body;
    // Custom-model overrides (e.g. maxOutput below the thinking floor) take
    // precedence over the static catalog.
    const caps = modelCapabilities || getCapabilitiesForModel(this.provider, model);
    if (!caps?.reasoning) return body;

    const reasoningEnabled = body.extra_body?.thinking?.type === "enabled" ||
    isString(body.reasoning_effort) && body.reasoning_effort !== "none" && body.reasoning_effort !== "off" ||
    body.reasoning_effort === true;
    if (!reasoningEnabled) return body;

    const cap = isNumber(caps.maxOutput) && caps.maxOutput > 0 ? caps.maxOutput : THINKING_BUDGET_FLOOR;
    // Preserve whichever token field the caller used; never introduce the other.
    const field = isNumber(body.max_completion_tokens) ? "max_completion_tokens" : "max_tokens";
    const next = computeThinkingBudget(body[field], cap);
    if (next != null) body[field] = next;
    return body;
  }

  // Some Responses-compatible upstreams (e.g. LM Studio) reject a request whose
  // `text` is an object missing `text.format` with a 400 missing_required_parameter.
  // The Responses API default for that field is { type: "text" }, so default it
  // for openai-compatible "responses" providers before forwarding upstream. #2093
  defaultResponsesTextFormat(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return;
    if (!this.provider.includes("responses")) return;
    const text = body.text;
    if (!text || !isObject(text) || Array.isArray(text)) return;
    if (text.format !== undefined) return;
    body.text = { ...text, format: { type: "text" } };
  }

  applyNousAttribution(model, body, stream, credentials) {
    // The built-in Nous provider uses the same attribution-protected endpoint.
    if (!(this.provider === "nous-research" || this.provider?.startsWith?.("openai-compatible-")) || !credentials?.apiKey
      || !isObject(body) || Array.isArray(body)
      || (body.tags != null && !Array.isArray(body.tags))) return body;

    try {
      const url = new URL(this.buildUrl(model, stream, 0, credentials));
      if (url.protocol !== "https:" || url.hostname !== NOUS_ATTRIBUTION.hostname
        || url.pathname !== NOUS_ATTRIBUTION.chatCompletionsPath) return body;
    } catch {
      return body;
    }

    // Parse once at the boundary: only string tags can carry attribution.
    let tags = (body.tags ?? []).filter(isString);
    for (const fallback of NOUS_ATTRIBUTION.tags) {
      const prefix = fallback.slice(0, fallback.indexOf("=") + 1);
      // Empty attribution values do not satisfy the upstream requirement.
      tags = tags.filter((tag) => !tag.startsWith(prefix) || tag.slice(prefix.length).trim());
      if (!tags.some((tag) => tag.startsWith(prefix))) tags.push(fallback);
    }
    return { ...body, tags: [...new Set(tags)] };
  }

  // DeepSeek and compatible providers use json_object; carry any schema in the prompt.
  applyJsonSchemaFallback(body) {
    if (this.provider !== "deepseek" && !this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || (!rf.json_schema?.schema && this.provider !== "deepseek")) return body;

    const schema = rf.json_schema?.schema;
    const schemaJson = schema ? JSON.stringify(schema, null, 2) : null;
    const prompt = schemaJson ? `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.` : "Respond with valid JSON only.";

    const messages = Array.isArray(body.messages) ? body.messages.map((m) => ({ ...m })) : [];
    const sys = messages.find((m) => m.role === "system");
    if (sys) {
      if (isString(sys.content)) sys.content = `${sys.content}\n\n${prompt}`;else
      if (Array.isArray(sys.content)) sys.content = [...sys.content, { type: "text", text: `\n\n${prompt}` }];
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Runtime transport (multi-endpoint providers): use the resolved endpoint.
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      if ((this.provider === "minimax" || this.provider === "minimax-cn") &&
        model === "M2-her" && rt.format === "openai") {
        return rt.baseUrl.replace(/\/v1\/chat\/completions$/, "/v1/text/chatcompletion_v2");
      }
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    }
    if (this.provider === "heroku") {
      return `${resolveHerokuBaseUrl(credentials)}/chat/completions`;
    }
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const apiType = getOpenAICompatibleType(this.provider, credentials);
      const path = apiType === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    if (LOCAL_PROVIDER_DEFAULT_BASE_URLS[this.provider]) {
      const baseUrl =
      credentials?.providerSpecificData?.baseUrl ||
      this.config.baseUrl ||
      LOCAL_PROVIDER_DEFAULT_BASE_URLS[this.provider];
      const normalized = baseUrl.replace(/\/$/, "");
      return normalized.endsWith("/chat/completions") ?
      normalized :
      `${normalized}/chat/completions`;
    }
    // gemini-format: build :streamGenerateContent / :generateContent path
    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    // urlSuffix (e.g. ?beta=true) declared per-provider in registry
    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl;
    if (!url) {
      const error = new Error(`Unknown provider "${this.provider}": no supported transport endpoint`);
      error.status = 400;
      throw error;
    }
    if (url?.includes("{accountId}")) {
      const accountId = normalizeAccountIdPlaceholder(this.provider, credentials?.providerSpecificData?.accountId);
      return url.replace("{accountId}", accountId);
    }
    return url;
  }

  // Fallback descriptor for providers without an explicit entry in AUTH_DESCRIPTORS.
  resolveAuthDescriptor() {
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return BEARER;
  }

  buildHeaders(credentials = {}, stream = true, requestContext = null, model = "") {
    credentials ||= {};
    const rt = credentials?.runtimeTransport;
    const headers = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
    const isSyntheticPublicCredential =
    (credentials.id === "noauth" || credentials.connectionId === "noauth") &&
    !credentials.apiKey &&
    (!credentials.accessToken || credentials.accessToken === "public");
    if (credentials.authType === "none" && isSyntheticPublicCredential) {
      if (stream) headers["Accept"] = "text/event-stream";
      normalizeAnthropicHeaders(headers);
      return headers;
    }
    if (!credentials.apiKey && !credentials.accessToken) {
      if (stream) headers["Accept"] = "text/event-stream";
      normalizeAnthropicHeaders(headers);
      return headers;
    }
    const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
    // Hooks run BEFORE auth so dynamic overlays (claude cached headers) can't clobber the token.
    for (const hook of desc.hooks || []) {
      if (hook !== "clineHeaders") HEADER_HOOKS[hook]?.(headers, credentials);
    }
    // Platform keys and Kimi Coding OAuth tokens belong to separate accounts.
    // Never fall back to an access token on the platform API-key connection.
    const authCredentials = this.provider === "kimi" ? { ...credentials, accessToken: undefined } : credentials;
    applyAuth(headers, desc, authCredentials);
    // Cline's hook normalizes OAuth JWTs; generic bearer auth otherwise overwrites it.
    if (desc.hooks?.includes("clineHeaders")) HEADER_HOOKS.clineHeaders(headers, credentials);

    // Claude Code OAuth Messages send `oauth-2025-04-20` (+ extended-cache-ttl);
    // the API-key path keeps the plain first-party pin (#1383).
    if (this.provider === "claude" && !credentials.apiKey && credentials.accessToken) {
      const betaKey = headers["anthropic-beta"] !== undefined ? "anthropic-beta" : "Anthropic-Beta";
      headers[betaKey] = buildClaudeOAuthAnthropicBeta(headers[betaKey]);
    }

    // The plain `anthropic` provider is an API-key provider: it does not use
    // the Claude Code wire protocol and is not an OAuth session, so the request
    // must not claim the Claude Code identity. Anthropic's Max and Team plans
    // include monthly API credits that do not cover Claude Code usage, and a
    // key funded only by those credits is mislabelled at best and rejected at
    // worst (OmniRoute #15968). The functional API betas stay.
    if (this.provider === "anthropic" && credentials.apiKey && !credentials.accessToken) {
      for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
        if (!headers[betaKey]) continue;
        const filtered = withoutClaudeCodeIdentityBetas(headers[betaKey]);
        if (filtered) headers[betaKey] = filtered;
        else delete headers[betaKey];
      }
    }

    /** Emit only client-provided session identity, never generated fallback affinity. */
    if (this.provider === "claude" && credentials?._clientSessionId && !credentials._clientSessionIsGenerated) {
      delete headers["x-claude-code-session-id"];
      headers["X-Claude-Code-Session-Id"] = credentials._clientSessionId;
    }

    if (this.provider === "opencode-go") {
      headers["x-opencode-session"] = credentials._openCodeGoSession || openCodeGoSessionHeader(credentials);
    }

    // anthropic-compatible-* nodes serving a real Claude model sit in front of
    // Anthropic itself (a rotating multi-account proxy, a corporate gateway),
    // so the request needs the same beta flags the `claude` provider sends:
    // without `context-management-2025-06-27` upstream rejects the
    // `context_management` block Claude Code puts in every request with
    // "context_management: Extra inputs are not permitted" (HTTP 400), and the
    // combo silently falls through to the next model. The model id gates this:
    // a node fronting Kimi or GLM answers on its own ids and never matches, so
    // gateways that would choke on unknown beta flags are left untouched.
    // (Port of decolua/9router#3797. Unlike upstream, the fork's `claude`
    // provider keeps its own header path — registry CLAUDE_API_HEADERS plus the
    // claudeOverlay live-header merge — so this block only covers
    // anthropic-compatible-* nodes.)
    const isClaudeModel = isString(model) && /^claude-/.test(model);
    const compatBaseUrl = credentials?.runtimeTransport?.baseUrl || credentials?.providerSpecificData?.baseUrl || "";
    // `claude` always targets api.anthropic.com; compat nodes only when their host is official.
    const firstPartyHost = this.provider === "claude" || compatBaseUrl === "" || isOfficialAnthropicBaseUrl(compatBaseUrl);
    const officialApiKey = isOfficialAnthropicApiKey(this.provider, credentials);
    const compatibleClaudeModel = this.provider?.startsWith?.("anthropic-compatible-") && isClaudeModel;
    if (compatibleClaudeModel) {
      const modelBeta = selectAnthropicBeta(model, { firstParty: firstPartyHost });
      const runtimeBeta = officialApiKey && rt?.headers ? new Headers(rt.headers).get("anthropic-beta") : null;
      headers["Anthropic-Beta"] = [modelBeta, runtimeBeta].filter(Boolean).join(",");
    }
    // OpenCode Go's Claude lane is a strict Anthropic proxy: context_management is
    // rejected (400) unless its paired beta flag is on the request. Forward the client's
    // flags (minus Claude Code identity flags) and add the pair when the body needs it.
    // Port of decolua/9router#4876; other opencode-go models keep no beta header.
    if (this.provider === "opencode-go" && isClaudeModel) {
      const clientBeta = withoutClaudeCodeIdentityBetas(
        requestContext?.clientHeaders?.["anthropic-beta"] ?? requestContext?.clientHeaders?.["Anthropic-Beta"]
      );
      const flags = new Set([clientBeta, credentials?._openCodeGoContextManagement ? "context-management-2025-06-27" : null]
        .filter(Boolean).flatMap((v) => v.split(",")).map((f) => f.trim()).filter(Boolean));
      if (flags.size > 0) headers["Anthropic-Beta"] = Array.from(flags).join(",");
    }
    if (this.provider === "claude" || (this.provider === "anthropic" && officialApiKey) || compatibleClaudeModel) {
      mergeForwardableClientBetas(headers, requestContext?.clientHeaders, { firstParty: firstPartyHost });
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = compatBaseUrl;
      /**
       * Exact-host check (CodeQL js/incomplete-url-substring-sanitization): a substring
       * `.includes("api.anthropic.com")` would accept look-alike upstreams such as
       * `https://api.anthropic.com.evil.test`, suppressing the Bearer fallback intended
       * for third-party gateways. An empty baseUrl means the default official endpoint;
       * anything else is verified via parsed hostname equality
       * ({@link isOfficialAnthropicBaseUrl}).
       */
      const isOfficialAnthropic = baseUrl === "" || isOfficialAnthropicBaseUrl(baseUrl);
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey].
            split(",").
            map((s) => s.trim()).
            filter((f) => f && f !== "claude-code-20250219").
            join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (officialApiKey) {
      const betas = [];
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "anthropic-beta") {
          betas.push(headers[key]);
          delete headers[key];
        } else if (lower === "x-app" || lower === "anthropic-dangerous-direct-browser-access") delete headers[key];
      }
      const filtered = withoutClaudeCodeIdentityBetas(betas.join(","));
      if (filtered) headers["Anthropic-Beta"] = [...new Set(filtered.split(","))].join(",");
    }
    if (stream) headers["Accept"] = "text/event-stream";
    normalizeAnthropicHeaders(headers);
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials, proxyOptions) {
    const grant = REFRESH_GRANTS[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json" ?
    this.refreshWithJSON(grant.url(), params, proxyOptions, grant.headers) :
    this.refreshWithForm(grant.url(), params, proxyOptions, grant.headers);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      openference: () => refreshOpenferenceToken(credentials, log, proxyOptions),
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      "codebuddy-cn": () => refreshCodebuddyToken(credentials.refreshToken, log, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      clinepass: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => refreshKimiToken(this.provider, credentials, log, proxyOptions),
      "kimi-ai": () => refreshKimiToken(this.provider, credentials, log, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null, extraHeaders = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", ...(extraHeaders || {}) },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null, extraHeaders = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", ...(extraHeaders || {}) },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken, proxyOptions = null) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId, client_secret: PROVIDERS.iflow.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCline(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    let accessToken = data?.accessToken;
    if (accessToken && !accessToken.startsWith("workos:")) {
      accessToken = `workos:${accessToken}`;
    }
    return { accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;
