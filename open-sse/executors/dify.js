import { randomUUID } from "node:crypto";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { readBoundedResponseText } from "../utils/error.js";
import { errorJson, extractTextFromContent, jsonResponse } from "./websession-utils.js";

const DIFY_BASE_URL = "https://api.dify.ai/v1";
const CHAT_URL = `${DIFY_BASE_URL}/chat-messages`;
const INFO_URL = `${DIFY_BASE_URL}/info`;
const PARAMETERS_URL = `${DIFY_BASE_URL}/parameters`;

function unsupported(message) {
  return errorJson(400, message, "unsupported_request");
}

function requestText(messages = []) {
  return messages.map((message) => {
    const content = extractTextFromContent(message?.content);
    return content ? `${message?.role || "user"}: ${content}` : "";
  }).filter(Boolean).join("\n");
}

function openAiResponse(data, model) {
  const usage = data?.metadata?.usage || {};
  return {
    id: data?.message_id || data?.id || `chatcmpl-dify-${randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    created: Number.isFinite(data?.created_at) ? data.created_at : Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: isString(data?.answer) ? data.answer : "" },
      finish_reason: "stop",
    }],
    ...(Number.isFinite(usage.prompt_tokens) || Number.isFinite(usage.completion_tokens) || Number.isFinite(usage.total_tokens) ? {
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    } : null),
  };
}
function streamFromCompletion(completion) {
  const encoder = new TextEncoder();
  const content = completion.choices?.[0]?.message?.content || "";
  const stream = new ReadableStream({
    start(controller) {
      const emit = (choices) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...completion, object: "chat.completion.chunk", choices })}\n\n`));
      emit([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]);
      if (content) emit([{ index: 0, delta: { content }, finish_reason: null }]);
      emit([{ index: 0, delta: {}, finish_reason: "stop" }]);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

export class DifyExecutor extends BaseExecutor {
  constructor() {
    super("dify", { id: "dify", baseUrl: DIFY_BASE_URL });
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions }) {
    if (model && model !== "configured-app" && model !== "dify/configured-app") return { response: unsupported("Dify uses the configured app, not an upstream model ID."), url: CHAT_URL, headers: {}, transformedBody: body };
    if (Array.isArray(body?.tools) && body.tools.length) return { response: unsupported("Dify configured-app does not support client tool execution."), url: CHAT_URL, headers: {}, transformedBody: body };
    if (Array.isArray(body?.messages) && body.messages.some((message) => Array.isArray(message?.content) && message.content.some((part) => part?.type && part.type !== "text" && part.type !== "input_text"))) return { response: unsupported("Dify configured-app does not support media inputs."), url: CHAT_URL, headers: {}, transformedBody: body };
    const query = requestText(body?.messages);
    if (!query) return { response: errorJson(400, "No text messages provided", "invalid_request"), url: CHAT_URL, headers: {}, transformedBody: body };
    const headers = { Authorization: `Bearer ${credentials?.apiKey || credentials?.accessToken || ""}`, "Content-Type": "application/json" };
    // Forward complete text history in query but never retain a Dify conversation across gateway users/requests.
    const transformedBody = { inputs: {}, query, response_mode: "blocking", user: randomUUID() };
    const response = await proxyAwareFetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(transformedBody), signal }, proxyOptions);
    if (!response.ok) {
      const text = await readBoundedResponseText(response, { signal });
      return { response: errorJson(response.status, text || `Dify returned HTTP ${response.status}`), url: CHAT_URL, headers, transformedBody };
    }
    const completion = openAiResponse(await response.json(), "configured-app");
    return { response: stream ? streamFromCompletion(completion) : jsonResponse(completion), url: CHAT_URL, headers, transformedBody };
  }

  async validate(credentials, signal, proxyOptions) {
    const headers = { Authorization: `Bearer ${credentials?.apiKey || credentials?.accessToken || ""}` };
    const [info, parameters] = await Promise.all([INFO_URL, PARAMETERS_URL].map((url) => proxyAwareFetch(url, { headers, signal }, proxyOptions)));
    return { info, parameters };
  }
}
