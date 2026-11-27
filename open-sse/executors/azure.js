import { DefaultExecutor } from "./default.js";
import { applyParamRenames, stripUnsupportedChatExtensions } from "../translator/concerns/paramSupport.js";
import { readBoundedResponseText } from "../utils/error.js";
import { settleProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { matchSkipRule, resolveRequestRetryPolicy } from "../config/runtimeConfig.js";

const TOKEN_LIMIT_PREFERENCE = Symbol("azureTokenLimitPreference");
const CACHE_LIMIT = 256;

// Azure GPT-5/GPT-6 and o-series deployments reject `max_tokens`, a custom
// `temperature`, and `reasoning_effort` next to tools on /chat/completions.
// Upstream provenance: decolua/9router#2809.
//
// The family is read from the deployment identifier this executor actually
// calls. Azure deployment names are operator-chosen and opaque, so an
// unrecognized name is left untouched instead of guessed: a deployment that
// serves another family keeps the fork's existing parameter contract, and the
// model-driven token-cap rename plus the negotiated one-shot retry below keep
// covering the token-cap spelling for opaque deployments.
const GPT5_FAMILY_DEPLOYMENT = /(?:^|[/_-])(?:gpt-(?:5|6)|o(?:1|3|4))(?:[._-]|$)/i;

/**
 * Normalize the request fields an Azure GPT-5-family deployment rejects.
 * Mutates and returns the same body.
 * - `max_tokens` → `max_completion_tokens` (an explicit modern limit wins).
 * - `temperature` is dropped unless it is the accepted default (1).
 * - `reasoning_effort` is dropped when tools are present; tools and
 *   `tool_choice` themselves are preserved.
 */
function normalizeGpt5FamilyRequest(body) {
  if (body.max_completion_tokens === undefined && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
  }
  delete body.max_tokens;
  if (body.temperature !== undefined && body.temperature !== 1) {
    delete body.temperature;
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    delete body.reasoning_effort;
  }
  return body;
}

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
    this.tokenLimitPreferences = new Map();
  }

  /**
   * The deployment this request is addressed to. Pool-mode connections
   * (`deploymentMode === "pool"`, decolua/9router#5901) dispatch to the
   * requested model id so one endpoint can serve multiple named deployments.
   * Legacy single-deployment connections keep `providerSpecificData.deployment`
   * ahead of the requested model id so the per-deployment token-limit cache
   * below stays intact.
   */
  resolveDeployment(model, credentials = null) {
    const data = credentials?.providerSpecificData;
    return (data?.deploymentMode === "pool" && model)
      || data?.deployment
      || model
      || process.env.AZURE_DEPLOYMENT
      || "gpt-4";
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const azureEndpoint = credentials?.providerSpecificData?.azureEndpoint
      || process.env.AZURE_ENDPOINT
      || "https://api.openai.com";

    const apiVersion = credentials?.providerSpecificData?.apiVersion
      || process.env.AZURE_API_VERSION
      || "2024-10-01-preview";

    const deployment = this.resolveDeployment(model, credentials);

    const endpoint = azureEndpoint.replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${apiVersion}`;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    const apiKey = credentials?.apiKey
      || credentials?.accessToken;

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
    // GPT-5-family deployments reject `max_tokens`, a custom `temperature`, and
    // `reasoning_effort` next to tools (#2809). Applied only when the
    // deployment is known to serve that family; an opaque deployment name
    // leaves the request untouched and keeps the fork's model-driven rename.
    if (GPT5_FAMILY_DEPLOYMENT.test(String(this.resolveDeployment(model, credentials)))) {
      normalizeGpt5FamilyRequest(transformed);
    } else {
      applyParamRenames("azure", model, transformed);
    }
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
