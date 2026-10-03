import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { getModelTargetFormat } from "../config/providerModels.js";

const BASE = "https://opencode.ai/zen/v1";

function targetFormat(model) {
  return getModelTargetFormat("opencode-zen", model);
}

export class OpenCodeZenExecutor extends BaseExecutor {
  constructor() {
    super("opencode-zen", PROVIDERS["opencode-zen"]);
  }

  buildUrl(model, stream = false) {
    const format = targetFormat(model);
    if (format === "gemini") {
      return `${BASE}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    if (format === "claude") return `${BASE}/messages`;
    if (format === "openai-responses") return `${BASE}/responses`;
    return `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true, requestContext = null, model = null) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (targetFormat(model) === "claude") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else if (targetFormat(model) === "gemini") {
      headers["x-goog-api-key"] = key;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}