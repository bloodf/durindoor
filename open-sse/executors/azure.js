import { DefaultExecutor } from "./default.js";
import { applyParamRenames, stripUnsupportedChatExtensions } from "../translator/concerns/paramSupport.js";
import { readBoundedResponseText } from "../utils/error.js";
import { settleProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { matchSkipRule, resolveRequestRetryPolicy } from "../config/runtimeConfig.js";

const TOKEN_LIMIT_PREFERENCE = Symbol("azureTokenLimitPreference");
const CACHE_LIMIT = 256;

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
    this.tokenLimitPreferences = new Map();
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const azureEndpoint = credentials?.providerSpecificData?.azureEndpoint
      || process.env.AZURE_ENDPOINT
      || "https://api.openai.com";

    const apiVersion = credentials?.providerSpecificData?.apiVersion
      || process.env.AZURE_API_VERSION
      || "2024-10-01-preview";

    const deployment = credentials?.providerSpecificData?.deployment
      || model
      || process.env.AZURE_DEPLOYMENT
      || "gpt-4";

    const endpoint = azureEndpoint.replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    const apiKey = credentials?.apiKey
      || credentials?.accessToken
      || process.env.OPENAI_API_KEY;

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization = credentials?.providerSpecificData?.organization
      || process.env.AZURE_ORGANIZATION;

    if (organization) {
      headers["OpenAI-Organization"] = organization;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    // Azure bypasses DefaultExecutor.transformRequest; invoke the shared helper
    // directly. Clone before mutating to avoid caller side effects. (#6912/#6964)
    const transformed = { ...(body || {}) };
    applyParamRenames("azure", model, transformed);
    const preference = requestContext?.[TOKEN_LIMIT_PREFERENCE];
    if (preference) {
      const alternate = preference === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      const value = body?.[preference] !== undefined ? body[preference] : body?.[alternate];
      if (value !== undefined) {
        transformed[preference] = value;
        delete transformed[alternate];
      }
    }
    stripUnsupportedChatExtensions(transformed, credentials?.runtimeTransport, this.config);
    return transformed;
  }

  // Learn only from an explicit rejection followed by a successful retry. The
  // preference is per deployment URL and never removes the caller's cap.
  async execute(options) {
    const url = this.buildUrl(options.model, options.stream, 0, options.credentials);
    const body = options.body || {};
    const hasLimit = body.max_tokens !== undefined || body.max_completion_tokens !== undefined;
    const cached = hasLimit ? this.tokenLimitPreferences.get(url) : undefined;
    const requestContext = options.requestContext || {};
    const run = async (preference) => {
      requestContext[TOKEN_LIMIT_PREFERENCE] = preference;
      try {
        return await super.execute({ ...options, requestContext });
      } finally {
        delete requestContext[TOKEN_LIMIT_PREFERENCE];
      }
    };
    const result = await run(cached);
    if (!hasLimit || result.response.status !== 400 || options.signal?.aborted) return result;
    let error, errorText;
    try {
      errorText = await readBoundedResponseText(result.response.clone(), {
        signal: options.signal, maxBytes: 64 * 1024, timeoutMs: 2000,
      });
      error = JSON.parse(errorText)?.error;
    } catch { return result; }
    const policy = resolveRequestRetryPolicy("azure", options.requestPolicy);
    // The base executor already owns matched skip/retry rules and their budget.
    if (policy.maxTransportAttempts === 1 ||
        matchSkipRule("azure", { status: 400, errorKind: "http_400", text: errorText }, policy.skipRules)) return result;
    const rejected = error?.param;
    if (error?.code !== "unsupported_parameter" ||
        !["max_tokens", "max_completion_tokens"].includes(rejected) ||
        result.transformedBody?.[rejected] === undefined || options.signal?.aborted) return result;
    const alternate = rejected === "max_tokens" ? "max_completion_tokens" : "max_tokens";
    if (cached) this.tokenLimitPreferences.delete(url);
    // Do not silently replace a caller's explicit modern limit with a legacy one.
    if (alternate === "max_tokens" && body.max_completion_tokens !== undefined) return result;
    await settleProviderAttemptDispatch(result.response, { success: false, reason: "fallback" });
    if (options.signal?.aborted) return result;
    result.response.body?.cancel().catch(() => {});
    const retry = await run(alternate);
    if (retry.response.ok) {
      this.tokenLimitPreferences.delete(url);
      if (this.tokenLimitPreferences.size >= CACHE_LIMIT) {
        this.tokenLimitPreferences.delete(this.tokenLimitPreferences.keys().next().value);
      }
      this.tokenLimitPreferences.set(url, alternate);
    }
    return retry;
  }
}
