import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";

const BASE = "https://opencode.ai/zen/v1";

const MESSAGES_FORMAT_MODELS = new Set([
  "qwen3.5-plus",
  "qwen3.6-plus",
  "qwen3.6-plus-free",
]);

function isResponsesModel(model) {
  return typeof model === "string" && /^gpt-5(?:[.-]|$)/.test(model);
}

export class OpenCodeZenExecutor extends BaseExecutor {
  constructor() {
    super("opencode-zen", PROVIDERS["opencode-zen"]);
  }

  buildUrl(model) {
    this._lastModel = model;
    if (MESSAGES_FORMAT_MODELS.has(model)) return `${BASE}/messages`;
    if (isResponsesModel(model)) return `${BASE}/responses`;
    return `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (MESSAGES_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
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
