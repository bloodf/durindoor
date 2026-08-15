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

  buildHeaders(credentials, stream = true, requestContext = null) {
    const clientHeaders = new Headers(requestContext?.clientHeaders ?? credentials?.rawHeaders ?? {});
    const clientUa = clientHeaders.get("user-agent");
    const synthesizeCli = /^(1|true|yes|on)$/i.test(process.env.OPENCODE_SYNTHESIZE_CLI_HEADERS?.trim() ?? "");
    const clientUaIsCli = /^opencode-cli\//i.test(clientUa?.trim() ?? "");
    const headers = {
      "Content-Type": "application/json",
      "x-opencode-client": clientHeaders.get("x-opencode-client") || "desktop",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
    if (clientUa) headers["User-Agent"] = synthesizeCli && !clientUaIsCli ? "opencode-cli/1.0.0" : clientUa;
    else if (synthesizeCli) headers["User-Agent"] = "opencode-cli/1.0.0";
    for (const name of ["x-opencode-project", "x-opencode-request", "x-opencode-session"]) {
      const value = clientHeaders.get(name);
      if (value) headers[name] = value;
    }
    return headers;
  }
}
