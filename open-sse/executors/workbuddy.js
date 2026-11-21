import { createHash } from "node:crypto";
import { repairChatHistory } from "./workbuddy-history.js";
import { conversationKey, sanitizeWorkbuddyBody, withWorkbuddyHeaders } from "./workbuddy-gateway.js";
import { DefaultExecutor } from "./default.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { clientHeaders } from "../providers/private/workbuddy.js";

// WorkBuddy device authorization and refresh are independent for each connection.
export class WorkbuddyExecutor extends DefaultExecutor {
  constructor() { super("workbuddy"); }
  async execute(input) {
    if (input.credentials?.providerSpecificData?.enableSessionDispatch !== true) {
      return { response: Response.json({ error: { message: "WorkBuddy dispatch requires enableSessionDispatch on this connection" } }, { status: 403 }), url: "", headers: {}, transformedBody: input.body };
    }
    return super.execute({ ...input, requestContext: { ...input.requestContext } });
  }
  buildHeaders(credentials, stream, context, model) {
    const headers = super.buildHeaders(credentials, stream, context, model);
    const identity = credentials?.connectionId || credentials?.id || credentials?.accessToken || "";
    const session = credentials?._clientSessionId || context?.sessionId || conversationKey(context?.workbuddyBody) || "";
    const scope = identity ? createHash("sha256").update(identity).update("|").update(session).digest("hex") : session;
    withWorkbuddyHeaders(headers, context?.workbuddyBody, scope || undefined);
    return headers;
  }
  transformRequest(model, body, stream, credentials, context) {
    const replacements = [
      ["x-anthropic-billing-header:", ""],
      ["You are Claude Code, Anthropic's official CLI for Claude", "You are Claude Code, Anthropic's CLI for Claude"],
      ["Main branch (you will usually use this for PRs)", "Main branch (usually the base for PRs)"],
      ["Codex CLI is an open source project led by OpenAI.", "The Codex CLI is an open source project led by OpenAI."],
      ["Codex CLI", "the assistant"], ["codex_cli_rs", "assistant"], ["OpenAI", "the provider"], ["Codex", "the assistant"],
    ];
    const original = super.transformRequest(model, body, stream, credentials, context);
    const repaired = repairChatHistory(original, { repairSequence: true, bodyStringReplacements: replacements });
    const transformed = { ...sanitizeWorkbuddyBody(repaired), stream: true };
    if (context) context.workbuddyBody = transformed;
    return transformed;
  }
  async refreshCredentials(credentials, _log, proxyOptions) {
    if (!credentials?.refreshToken) return null;
    try {
      const response = await proxyAwareFetch("https://www.workbuddy.ai/v2/plugin/auth/token/refresh", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...clientHeaders, "X-Refresh-Token": credentials.refreshToken }, body: "{}",
      }, proxyOptions);
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload.code !== 0 || !payload.data?.accessToken) return null;
      return { accessToken: payload.data.accessToken, refreshToken: payload.data.refreshToken || credentials.refreshToken, expiresIn: payload.data.expiresIn };
    } catch { return null; }
  }
}
