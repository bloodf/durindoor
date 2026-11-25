// Adapted from OmniRoute open-sse/executors/nlpcloud.ts at
// 2c4aa9e9af21e2ad27440c4c478c10282154a596 (MIT). The NLP Cloud chatbot
// endpoint uses input/context/history and returns response or streamed text.
import { randomUUID } from "node:crypto";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { BaseExecutor } from "./base.js";
import { ROLE, OPENAI_BLOCK } from "../translator/schema/index.js";
import { createExecutorSender } from "./sendRequest.js";
import { buildErrorBody, readBoundedResponseText, sanitizeErrorMessageWithSecrets } from "../utils/error.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";

export const NLP_CLOUD_BASE = "https://api.nlpcloud.io/v1/gpu";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const DONE = "[DONE]";
const jsonResponse = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fail = (status, message) => jsonResponse(status, buildErrorBody(status, message));

// Reject unrepresentable conversations instead of silently discarding turns.
export function chatbotRequest(body, stream) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length) throw new Error("A user message is required");
  if (body.tools?.length || body.functions?.length || (body.response_format?.type && body.response_format.type !== "text")) throw new Error("Tools and structured output are not supported");
  const context = [], turns = [];
  for (const message of body.messages) {
    if (message.tool_calls?.length || message.function_call) throw new Error("Tool calls are not supported");
    let content = message.content;
    if (Array.isArray(content)) {
      if (content.some((part) => part?.type !== OPENAI_BLOCK.TEXT || !isString(part.text))) throw new Error("Only text inputs are supported");
      content = content.map((part) => part.text).join("");
    }
    if (!isString(content) || !content.trim()) throw new Error("Messages must contain text");
    if (message.role === ROLE.SYSTEM || message.role === ROLE.DEVELOPER) {
      if (turns.length) throw new Error("System messages must precede the conversation");
      context.push(content);
    } else if (message.role === ROLE.USER || message.role === ROLE.ASSISTANT) {
      const expected = turns.length % 2 === 0 ? ROLE.USER : ROLE.ASSISTANT;
      if (message.role !== expected) throw new Error("Conversation must alternate user and assistant messages");
      turns.push({ role: message.role, content });
    } else throw new Error("Only user and assistant messages are supported");
  }
  if (!turns.length || turns.at(-1).role !== ROLE.USER) throw new Error("The final message must be from the user");
  const history = [];
  for (let i = 0; i < turns.length - 1; i += 2) history.push({ input: turns[i].content, response: turns[i + 1].content });
  const payload = { input: turns.at(-1).content };
  if (context.length) payload.context = context.join("\n\n");
  if (history.length) payload.history = history;
  if (stream) payload.stream = true;
  return payload;
}

// Native chatbot streaming appends [DONE] to raw text. Confirm it at clean
// EOF so a marker embedded in generated text cannot finish the stream early.
export function translateNlpCloudStream(upstream, model, id, created) {
  const reader = upstream.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder();
  let buffer = "", finished = false, cancelled = false, hasOutput = false, roleSent = false;
  const queue = [];
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const emit = (text) => {
    if (!text) return;
    if (!roleSent) { queue.push(chunk({ role: ROLE.ASSISTANT })); roleSent = true; }
    hasOutput ||= Boolean(text.trim());
    queue.push(chunk({ content: text }));
  };
  const cancel = (reason) => { try { void reader.cancel(reason).catch(() => {}); } catch { /* cleanup */ } };
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!queue.length && !finished && !cancelled) {
          const { value, done } = await reader.read();
          if (cancelled) return;
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          if (done) {
            if (!buffer.endsWith(DONE)) throw new Error("NLP Cloud stream ended before completion");
            emit(buffer.slice(0, -DONE.length));
            if (!hasOutput) throw new Error("NLP Cloud returned no stream output");
            queue.push(chunk({}, "stop"), "data: [DONE]\n\n");
            finished = true;
            reader.releaseLock();
          } else if (buffer.length > DONE.length) {
            const count = buffer.length - DONE.length;
            emit(buffer.slice(0, count));
            buffer = buffer.slice(count);
          }
        }
        if (queue.length) controller.enqueue(encoder.encode(queue.shift()));
        else if (finished) controller.close();
      } catch (error) { cancel("NLP Cloud stream failed"); controller.error(error); }
    },
    cancel(reason) { cancelled = true; queue.length = 0; cancel(reason); },
  });
}

export class NlpCloudExecutor extends BaseExecutor {
  constructor() { super("nlpcloud", { id: "nlpcloud", baseUrl: NLP_CLOUD_BASE, format: "openai" }); }
  buildUrl(model) { return `${NLP_CLOUD_BASE}/${encodeURIComponent(model)}/chatbot`; }
  buildHeaders(credentials, stream) {
    return { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json", Authorization: `Bearer ${credentials?.apiKey || credentials?.accessToken || ""}` };
  }
  async execute(input) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = input;
    let payload;
    const url = this.buildUrl(model || "");
    const sender = createExecutorSender(this, input);
    const result = (response, headers = {}, transformedBody = body, terminalProvenance) => ({ response, url, headers, transformedBody, terminalProvenance, attemptStartedAt: sender.attemptStartedAt });
    // The physical upstream Response owns the quota dispatch ticket. Every
    // returned response below replaces it, so the ticket has to follow the
    // replacement; otherwise the reservation is orphaned and never settled.
    const carryTicket = (upstream, returned) => {
      transferProviderAttemptDispatch(upstream, returned);
      return returned;
    };
    if (!credentials?.apiKey && !credentials?.accessToken) return result(fail(401, "NLP Cloud API key is missing"));
    if (!isString(model) || !model || model.includes("/") || model === "." || model === "..") return result(fail(400, "Invalid NLP Cloud model"));
    try { payload = chatbotRequest(body, stream); } catch (error) { return result(fail(400, error.message)); }
    const headers = this.buildHeaders(credentials, stream);
    let response;
    try {
      response = await sender.sendRequest(url, { method: "POST", headers, body: JSON.stringify(payload), signal }, proxyOptions);
    } catch (error) {
      // A local quota denial is a gateway capacity decision, not a provider
      // failure. Keep its type so chatCore reports local quota unavailability
      // instead of an upstream 502; the request never reached the provider.
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      return result(fail(502, "NLP Cloud request failed"), headers, payload);
    }
    if (!response.ok) {
      let text;
      try { text = await readBoundedResponseText(response, { signal }); }
      catch (error) { if (error?.name === "AbortError" || signal?.aborted) throw error; text = ""; }
      let message = `NLP Cloud API failed with status ${response.status}`;
      try { const data = JSON.parse(text); if (isString(data.detail)) message = data.detail; } catch { /* fixed fallback */ }
      const status = response.status >= 400 ? response.status : 502;
      return result(carryTicket(response, fail(status, sanitizeErrorMessageWithSecrets(message, [credentials.apiKey, credentials.accessToken].filter(Boolean)))), headers, payload);
    }
    const id = `chatcmpl-nlpcloud-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
    if (stream) {
      if (!response.body) return result(carryTicket(response, fail(502, "NLP Cloud returned an empty stream")), headers, payload);
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream") {
        void response.body.cancel().catch(() => {});
        return result(carryTicket(response, fail(502, "NLP Cloud returned an invalid stream type")), headers, payload);
      }
      return result(carryTicket(response, new Response(translateNlpCloudStream(response.body, model, id, created), { headers: { "Content-Type": "text/event-stream" } })), headers, payload, "validated");
    }
    let data;
    try { data = JSON.parse(await readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BYTES, timeoutMs: 30000, throwOnTimeout: true })); }
    catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      return result(carryTicket(response, fail(502, "NLP Cloud returned an unreadable response")), headers, payload);
    }
    if (!isString(data?.response) || !data.response.trim()) return result(carryTicket(response, fail(502, "NLP Cloud returned an invalid response")), headers, payload);
    return result(carryTicket(response, jsonResponse(200, { id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: data.response }, finish_reason: "stop" }] })), headers, payload, "validated");
  }
}
