import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";

// Models that use /zen/v1/messages (claude format)
const MESSAGES_MODELS = new Set();

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body) {
    const transformed = injectReasoningContent({ provider: this.provider, model, body });
    if (
      transformed &&
      typeof transformed === "object" &&
      !Array.isArray(transformed) &&
      Object.prototype.hasOwnProperty.call(transformed, "client_metadata")
    ) {
      const cleaned = { ...transformed };
      delete cleaned.client_metadata;
      return cleaned;
    }
    return transformed;
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return MESSAGES_MODELS.has(model)
      ? `${base}/zen/v1/messages`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-opencode-client": "desktop",
      "Accept": "text/event-stream"
    };
  }
}
