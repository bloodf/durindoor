import { BaseExecutor } from "./base.js";
import { FORMATS } from "../translator/formats.js";
import { OPENAI_BLOCK, RESPONSES_ITEM, ROLE } from "../translator/schema/index.js";
import { guardedProbeFetch } from "../utils/outboundUrlGuard.js";
import {
  OPENCODE_GENERATE_PATH,
  OPENCODE_SERVER_ID,
  resolveOpenCodeServer,
} from "../services/opencodeServer.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const ALLOWED_ROLES = new Set([ROLE.SYSTEM, ROLE.DEVELOPER, ROLE.USER, ROLE.ASSISTANT]);
const GENERATION_TIMEOUT_MS = 120_000;
const UNSUPPORTED = "OpenCode Server supports stateless text only, without tools or session features";

function textPrompt(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  const turns = [];
  for (const message of messages) {
    if (!ALLOWED_ROLES.has(message?.role) || message.tool_calls != null || message.function_call != null) return null;
    const { content } = message;
    if (!isString(content) && (!Array.isArray(content) ||
        !content.every((block) => block?.type === OPENAI_BLOCK.TEXT && isString(block.text)))) return null;
    const text = isString(content) ? content : content.map((block) => block.text).join("\n");
    turns.push(messages.length === 1 && message.role === ROLE.USER ? text : `${message.role}: ${text}`);
  }
  return turns.join("\n\n");
}

export class OpenCodeServerExecutor extends BaseExecutor {
  constructor() {
    super(OPENCODE_SERVER_ID, { timeoutMs: GENERATION_TIMEOUT_MS });
  }

  // Validate the source before translators can drop unsupported tool/session fields.
  validateClientRequest(body, sourceFormat) {
    const toolDeclarations = (value) => value != null && (!Array.isArray(value) || value.length > 0);
    if (toolDeclarations(body.tools) || toolDeclarations(body.functions) ||
        (body.tool_choice != null && body.tool_choice !== "none") ||
        (body.function_call != null && body.function_call !== "none") ||
        ["previous_response_id", "conversation", "conversation_id", "sessionID", "sessionId",
          "session_id", "session", "agent", "location", "directory", "workspace", "prompt"].some((field) => body[field] != null) ||
        body.store === true) return UNSUPPORTED;
    if (sourceFormat === FORMATS.OPENAI) return textPrompt(body.messages) === null ? UNSUPPORTED : null;
    // The Responses translator can discard reference and tool items.
    if (sourceFormat !== FORMATS.OPENAI_RESPONSES) return UNSUPPORTED;
    if (isString(body.input)) return body.input.trim() ? null : UNSUPPORTED;
    const items = body.input;
    if (!Array.isArray(items) || !items.length) return UNSUPPORTED;
    const textItems = items.every((item) =>
      (item?.type === RESPONSES_ITEM.MESSAGE || item?.type === undefined) &&
      ALLOWED_ROLES.has(item?.role) &&
      (isString(item.content) || (Array.isArray(item.content) && item.content.every((part) =>
        (part?.type === RESPONSES_ITEM.INPUT_TEXT || part?.type === RESPONSES_ITEM.OUTPUT_TEXT) && isString(part.text)))));
    if (textItems) return null;
    return UNSUPPORTED;
  }

  buildUrl(_model, _stream, _index, credentials) {
    return `${resolveOpenCodeServer(credentials).baseUrl}${OPENCODE_GENERATE_PATH}`;
  }

  buildHeaders(credentials) {
    return resolveOpenCodeServer(credentials).headers;
  }

  async execute(options) {
    const { model, body, credentials, signal } = options;
    const endpoint = resolveOpenCodeServer(credentials);
    const failure = (status, message) => Response.json({ error: { message } }, { status });
    if (endpoint.error) return { response: failure(endpoint.status, endpoint.error), terminalProvenance: "local" };
    const split = model.indexOf("/");
    const prompt = textPrompt(body.messages);
    if (split < 1 || split === model.length - 1 || prompt === null || !prompt.trim()) {
      return { response: failure(400, "OpenCode Server requires a provider/model ID and text input"), terminalProvenance: "local" };
    }
    const requestSignal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
    const result = await super.execute({
      ...options,
      body: { model: { providerID: model.slice(0, split), id: model.slice(split + 1) }, prompt },
      signal: signal ? AbortSignal.any([signal, requestSignal]) : requestSignal,
      proxyOptions: { disableEnvProxy: true },
      directFetch: async (url, init) => {
        const response = await guardedProbeFetch(url, init);
        if (response.ok) return response;
        void response.body?.cancel().catch(() => {});
        const status = response.status >= 400 ? response.status : 502;
        const message = status === 404
          ? "OpenCode Server generation endpoint or selected model is unavailable"
          : `OpenCode Server generation returned HTTP ${response.status}`;
        // Keep BaseExecutor from stripping a required model or prompt on a 400.
        const safeResponse = failure(status, message);
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) safeResponse.headers.set("retry-after", retryAfter);
        return safeResponse;
      },
    });
    const { response } = result;
    if (!response.ok) return result;
    try {
      const payload = await response.json();
      if (!isString(payload?.data?.text)) throw new Error("Invalid generation response");
      return {
        ...result,
        response: Response.json({
          id: `chatcmpl-${globalThis.crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: payload.data.text }, finish_reason: "stop" }],
        }),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...result, response: failure(502, "Invalid OpenCode Server stateless generation response") };
    }
  }
}
