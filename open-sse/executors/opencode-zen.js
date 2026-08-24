import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { isString } from "@/shared/utils/typeChecks.js";

const BASE = "https://opencode.ai/zen/v1";

const MESSAGES_FORMAT_MODELS = new Set([
"qwen3.5-plus",
"qwen3.6-plus",
"qwen3.6-plus-free"]
);

function isClaudeModel(model) {
  return isString(model) && model.startsWith("claude-");
}

function isGeminiModel(model) {
  return isString(model) && model.startsWith("gemini-");
}

function isMessagesModel(model) {
  return isClaudeModel(model) || MESSAGES_FORMAT_MODELS.has(model);
}

function isResponsesModel(model) {
  return isString(model) && /^gpt-5(?:[.-]|$)/.test(model);
}

export class OpenCodeZenExecutor extends BaseExecutor {
  constructor() {
    super("opencode-zen", PROVIDERS["opencode-zen"]);
  }

  buildUrl(model) {
    if (isGeminiModel(model)) {
      throw new Error("OpenCode Zen Gemini models require the Google-compatible custom-provider route, which is not implemented yet");
    }
    if (isMessagesModel(model)) return `${BASE}/messages`;
    if (isResponsesModel(model)) return `${BASE}/responses`;
    return `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true, requestContext = null, model = null) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (isMessagesModel(model)) {
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