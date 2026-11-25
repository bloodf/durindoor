import { DefaultExecutor } from "./default.js";
import { normalizeCodeBuddyRequest, normalizeCodeBuddyResponse, sanitizeCodeBuddyMessages } from "./codebuddy-protocol.js";
import { ROLE } from "../translator/schema/index.js";

// OmniRoute bd9b1324 open-sse/executors/codebuddy-intl.ts requires a leading
// system message. Apply identity-line sanitization while retaining its provider
// specific request conversion and leading-system-message behavior.
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() { super("codebuddy-intl"); }

  transformRequest(model, body, stream, credentials, requestContext) {
    const result = super.transformRequest(model, body, stream, credentials, requestContext);
    result.stream = true;
    if (Array.isArray(result.messages)) {
      result.messages = sanitizeCodeBuddyMessages(this.provider, result.messages);
    }
    if (Array.isArray(result.messages) && result.messages[0]?.role !== ROLE.SYSTEM) {
      result.messages = [{ role: ROLE.SYSTEM, content: "You are a helpful assistant." }, ...result.messages];
    }
    return normalizeCodeBuddyRequest(result);
  }

  async execute(options) {
    return normalizeCodeBuddyResponse(await super.execute(options));
  }
}
