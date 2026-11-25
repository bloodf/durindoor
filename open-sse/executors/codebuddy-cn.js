import { DefaultExecutor } from "./default.js";
import { normalizeCodeBuddyRequest, normalizeCodeBuddyResponse, sanitizeCodeBuddyMessages } from "./codebuddy-protocol.js";

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions.
 * CodeBuddy rejects non-stream chat requests (HTTP 400, code 11101), so every
 * request is forced to stream; 9router re-aggregates SSE for JSON clients.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  transformRequest(model, body, stream, credentials, requestContext = null) {
    // Tencent's content filter flags CLI agent system prompts ("You are Claude
    // Code, Anthropic's official CLI...") as prompt injection / sensitive content
    // and rejects the whole request. Replace only matching identity lines while
    // preserving client rules and the original string or typed-block shape.
    const transformed = super.transformRequest(model, body, stream, credentials, requestContext);
    transformed.stream = true;

    if (Array.isArray(transformed.messages)) {
      transformed.messages = sanitizeCodeBuddyMessages(this.provider, transformed.messages);
    }

    return normalizeCodeBuddyRequest(transformed);
  }

  async execute(options) {
    return normalizeCodeBuddyResponse(await super.execute(options));
  }
}

export default CodeBuddyExecutor;
