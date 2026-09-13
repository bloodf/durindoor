// Chat-style inference endpoints: OpenAI chat completions, Anthropic
// Messages, OpenAI Responses (+ compact) and Gemini generateContent.

import { reply } from "../../http.js";
import { cannedReply, lastUserText } from "../../fixtures/playgroundReplies.js";
import {
  claudeMessage,
  claudeStream,
  geminiResponse,
  geminiStream,
  openaiChatCompletion,
  openaiChatStream,
  responsesObject,
  responsesStream,
} from "../../fixtures/playgroundFrames.js";
import { onBoth, streamFrames } from "./stream.js";

function invalid(message) {
  return reply({ error: { message, type: "invalid_request_error", code: "invalid_request" } }, { status: 400 });
}

function asObject(body) {
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

function prepare(body) {
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "auto";
  const prompt = lastUserText(body);
  return { model, prompt, text: cannedReply(prompt, model) };
}

function chatCompletions({ body, signal }) {
  const request = asObject(body);
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    return invalid("messages is required and must be a non-empty array");
  }
  const args = prepare(request);
  return request.stream ? streamFrames(openaiChatStream(args), { signal }) : openaiChatCompletion(args);
}

function messages({ body, signal }) {
  const request = asObject(body);
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    return reply({ type: "error", error: { type: "invalid_request_error", message: "messages: field required" } }, { status: 400 });
  }
  const args = prepare(request);
  return request.stream ? streamFrames(claudeStream(args), { signal }) : claudeMessage(args);
}

function responses({ body, signal }) {
  const request = asObject(body);
  if (!request || (request.input == null && !Array.isArray(request.messages))) {
    return invalid("input is required");
  }
  const args = prepare(request);
  return request.stream ? streamFrames(responsesStream(args), { signal }) : responsesObject(args);
}

function compact({ body }) {
  const request = asObject(body) || {};
  const args = prepare(request);
  const summary = `Conversation summary: the user asked about ${args.prompt ? `"${args.prompt.slice(0, 120)}"` : "a coding task"}; the assistant proposed a step-by-step plan and a code sample. Keep the retry helper and the combo fallback context.`;
  return { ...responsesObject({ ...args, text: summary }), object: "response.compaction" };
}

function generateContent({ params, body, signal }) {
  const request = asObject(body) || {};
  const [modelPart = "gemini", action = ""] = String(params.rest || "").split(":");
  const args = prepare({ ...request, model: request.model || modelPart });
  return action === "streamGenerateContent" ? streamFrames(geminiStream(args), { signal }) : geminiResponse(args);
}

export default function registerChat(router) {
  onBoth(router, "post", "/chat/completions", chatCompletions);
  onBoth(router, "post", "/messages", messages);
  onBoth(router, "post", "/responses", responses);
  onBoth(router, "post", "/responses/compact", compact);
  router.post("/v1/messages/count_tokens", ({ body }) => ({ input_tokens: Math.ceil(JSON.stringify(body?.messages || []).length / 4) }));
  router.post("/v1beta/models/*rest", generateContent);
}
