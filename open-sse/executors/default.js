import crypto from "crypto";
import { normalizeNvidiaToolCallIds } from "../translator/concerns/toolCall.js";
import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH, resolveHerokuBaseUrl } from "../config/providers.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { applyDeepSeekV4ProAlias, injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getOpenAICompatibleType } from "../services/provider.js";
import { refreshCodebuddyToken } from "../services/tokenRefresh.js";
import { isOfficialAnthropicBaseUrl } from "../utils/anthropicHost.js";
import { stripUnsupportedParams, applyParamRenames } from "../translator/concerns/paramSupport.js";
import { FORMATS } from "../translator/formats.js";
// Opt-in prompt-cache key injection for openai-compatible providers.
// OpenAI-style upstreams (Chat Completions + Responses) accept an optional
// `prompt_cache_key` routing hint that pins a conversation to a cache shard,
// the same mechanism the Codex executor uses. We do NOT enable it by default:
// some strict openai-compatible gateways reject unknown fields. A custom
// provider opts in via providerSpecificData.enablePromptCacheKey === true.
import { isNumber, isObject, isString } from "@/shared/utils/typeChecks.js";export function normalizePromptCacheKey(provider, sessionId) {
  if (!sessionId) return "";
  const scoped = `${provider || "openai-compatible"}:${sessionId}`;
  return `cc_${crypto.createHash("sha256").update(scoped).digest("hex").slice(0, 32)}`;
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

// Upstream decolua/9router#2533: MiniMax documents MiniMax-M3 on the standard
// OpenAI API endpoint /v1/text/chatcompletion_v2 rather than /v1/chat/completions.
// Only rewrite the URL when the resolved transport is the OpenAI one for MiniMax-M3
// — the Claude transport (x-api-key, ?beta=true) and every other MiniMax model
// keep their URL.
const MINIMAX_M3_PROVIDERS = new Set(["minimax", "minimax-cn"]);

function resolveMiniMaxM3Url(provider, model, url, transportFormat) {
  if (!MINIMAX_M3_PROVIDERS.has(provider) || model !== "MiniMax-M3") return url;
  if (transportFormat !== "openai") return url;
  return url.replace(/\/v1\/chat\/completions$/, "/v1/text/chatcompletion_v2");
}

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

// Resolve auth onto headers from a descriptor.
function applyAuth(headers, desc, credentials) {
  if (desc.combined) {
    setAuth(headers, desc, credentials.apiKey || credentials.accessToken);
    applyExtraHeaders(headers, desc.extraHeaders, credentials);
    if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return;
  }
  // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);else
  if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  applyExtraHeaders(headers, desc.extraHeaders, credentials);
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
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
  kimiHeaders: (h) => Object.assign(h, buildKimiHeaders()),
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
    return [id, {
      encoding,
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

// Pure budget decision mirroring upstream #2332: returns the token count to
// write, or null to leave as-is. Never lowers a positive budget; bumps an
// undersized one only when the cap allows reaching the full floor.
export function computeThinkingBudget(current, cap) {
  const maxOutput = isNumber(cap) && cap > 0 ? cap : THINKING_BUDGET_FLOOR;
  const target = Math.min(THINKING_BUDGET_FLOOR, maxOutput);
  if (!isNumber(current) || current <= 0) return target;
  // Never lower a positive budget; only bump when the cap can reach the floor.
  if (current < THINKING_BUDGET_FLOOR && maxOutput >= THINKING_BUDGET_FLOOR) return THINKING_BUDGET_FLOOR;
  return null;
}

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
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
    this.config?.clampRequestBody?.(body);
    applyGlmtModelAlias(this.provider, model, body);
    let transformed = this.applyJsonSchemaFallback(body);

    const transportFormat = credentials?.runtimeTransport?.format?.replace(/-apikey$/, "") || this.config.format;
    transformed = applyDeepSeekV4ProAlias({
      provider: this.provider,
      model: requestContext?.catalogModel || model,
      body: transformed,
      transportFormat
    });


    if (transformed && isObject(transformed)) {
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
      if (this.config.quirks?.dropClientMetadata) {
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
      injectPromptCacheKey(this.provider, transformed, credentials);
      injectOpenAIStore(transformed, this.provider, credentials, transportFormat);
      applyParamRenames(this.provider, model, transformed, requestContext?.modelCapabilities);
      stripUnsupportedParams(this.provider, model, transformed, requestContext?.modelCapabilities);
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
    if (credentials?.runtimeTransport?.format === "claude") {
      return this.ensureThinkingBudget(transformed, model, requestContext?.modelCapabilities);
    }
    return this.ensureThinkingBudget(injectReasoningContent({ provider: this.provider, model, body: transformed }), model, requestContext?.modelCapabilities);
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

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map((m) => ({ ...m })) : [];
    const sys = messages.find((m) => m.role === "system");
    if (sys) {
      if (isString(sys.content)) sys.content = `${sys.content}\n\n${prompt}`;else
      if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Runtime transport (multi-endpoint providers): use the resolved endpoint.
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      const url = rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
      return resolveMiniMaxM3Url(this.provider, model, url, rt.format);
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

  buildHeaders(credentials = {}, stream = true) {
    credentials ||= {};
    const rt = credentials?.runtimeTransport;
    const headers = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
    if (!credentials.apiKey && !credentials.accessToken) {
      if (stream) headers["Accept"] = "text/event-stream";
      return headers;
    }
    const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
    // Hooks run BEFORE auth so dynamic overlays (claude cached headers) can't clobber the token.
    for (const hook of desc.hooks || []) HEADER_HOOKS[hook]?.(headers, credentials);
    applyAuth(headers, desc, credentials);

    /** Emit only client-provided session identity, never generated fallback affinity. */
    if (this.provider === "claude" && credentials?._clientSessionId && !credentials._clientSessionIsGenerated) {
      delete headers["x-claude-code-session-id"];
      headers["X-Claude-Code-Session-Id"] = credentials._clientSessionId;
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
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

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials, proxyOptions) {
    const grant = REFRESH_GRANTS[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json" ?
    this.refreshWithJSON(grant.url(), params, proxyOptions) :
    this.refreshWithForm(grant.url(), params, proxyOptions);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      "codebuddy-cn": () => refreshCodebuddyToken(credentials.refreshToken, log, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      clinepass: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken, proxyOptions),
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

  async refreshWithJSON(url, body, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
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

  async refreshKimiCoding(refreshToken, proxyOptions = null) {
    const kimiHeaders = buildKimiHeaders();
    const response = await proxyAwareFetch(PROVIDERS["kimi-coding"].refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS["kimi-coding"].clientId })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;