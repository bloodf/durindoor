import { createHmac, randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { errorResponse } from "../utils/error.js";
import { createExecutorSender, requestAbortError } from "./sendRequest.js";
import { settleProviderAttemptDispatch, transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

import { readZaiBody } from "./zai-web/readBody.js";
import { redactZaiProof, resolveZaiCaptchaVerifyParam, resolveZaiWebSession } from "./zai-web/session.js";

const ORIGIN = "https://chat.z.ai";
const NEW_CHAT = `${ORIGIN}/api/v1/chats/new`;
const COMPLETIONS = `${ORIGIN}/api/v2/chat/completions`;
const FE_VERSION = "prod-fe-1.1.92";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const SIGNING_KEY = "key-@@@@)))()((9))-xxxx&&&%%%%%";

export function extractZaiWebToken(value) {
  const raw = isString(value) ? value.trim() : "";
  const bearer = raw.match(/^(?:Authorization:\s*)?Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const cookie = raw.match(/(?:^|;\s*)token=([^;]+)/);
  if (cookie) return cookie[1].trim();
  return raw.includes(";") || raw.includes("=") ? "" : raw;
}

function userIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return isString(payload.id) ? payload.id : "";
  } catch { return ""; }
}

function headers(token, accept = "application/json") {
  return { "Content-Type": "application/json", Accept: accept, "Accept-Language": "en-US", "User-Agent": USER_AGENT, Origin: ORIGIN, Referer: `${ORIGIN}/`, Authorization: `Bearer ${token}` };
}

function signature(prompt, requestId, timestamp, userId) {
  const sorted = Object.entries({ timestamp: String(timestamp), requestId, user_id: userId }).sort(([a], [b]) => a.localeCompare(b)).join(",");
  const bucket = Math.floor(timestamp / 300000);
  const key = createHmac("sha256", SIGNING_KEY).update(String(bucket)).digest("hex");
  return createHmac("sha256", key).update(`${sorted}|${Buffer.from(prompt).toString("base64")}|${timestamp}`).digest("hex");
}

function completionUrl(token, userId, requestId, timestamp) {
  const params = new URLSearchParams({ timestamp: String(timestamp), requestId, user_id: userId, version: "0.0.1", platform: "web", token, user_agent: USER_AGENT, language: "en-US", languages: "en-US,en", timezone: "UTC", cookie_enabled: "true", screen_width: "1280", screen_height: "800", screen_resolution: "1280x800", viewport_height: "800", viewport_width: "1280", viewport_size: "1280x800", color_depth: "24", pixel_ratio: "1", current_url: `${ORIGIN}/`, pathname: "/", host: "chat.z.ai", hostname: "chat.z.ai", protocol: "https:", title: "Z.ai - Advanced AI Chatbot", timezone_offset: "0", local_time: new Date(timestamp).toISOString(), utc_time: new Date(timestamp).toUTCString(), signature_timestamp: String(timestamp) });
  return `${COMPLETIONS}?${params}`;
}

async function readCompletion(response, signal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Invalid Z.ai stream");
  const text = await readZaiBody(response, signal);
  let terminal = false;
  let content = ""; let reasoning = ""; let failure = "";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:") && line.slice(5).trim() === "[DONE]") { terminal = true; continue; }
    if (!line.startsWith("data:")) continue;
    try {
      const frame = JSON.parse(line.slice(5).trim());
      const data = frame.data ?? frame;
      const error = frame.error ?? data.error;
      if ((frame.code != null && frame.code !== 0) || (data.code != null && data.code !== 0)) { failure = "Z.ai completion rejected"; break; }
      if (data.done === true || data.phase === "done" || data.phase === "finish" || frame.type === "chat:completion:finish" || frame.choices?.[0]?.finish_reason) terminal = true;
      if (error) { failure = isString(error) ? error : error.message ?? error.detail ?? "Z.ai chat failed"; break; }
      const choices = frame.choices?.[0]?.delta;
      if (choices) {
        if ((choices.content != null && !isString(choices.content)) || (choices.reasoning_content != null && !isString(choices.reasoning_content))) throw new Error("Malformed delta");
        content += choices.content ?? ""; reasoning += choices.reasoning_content ?? ""; continue; }
      const delta = data.delta_content ?? data.edit_content ?? data.content ?? "";
      if (isString(delta)) (data.phase === "thinking" ? (reasoning += delta) : (content += delta));
    } catch { failure = "Malformed Z.ai stream"; break; }
  }
  if (failure || !terminal || (!content && !reasoning)) throw new Error("Invalid or failed Z.ai completion");
  return { content, reasoning };
}

export class ZaiWebExecutor extends BaseExecutor {
  constructor() { super("zai-web", { id: "zai-web", baseUrl: ORIGIN }); }

  async execute(input) {
    input.signal?.throwIfAborted();
    const token = resolveZaiWebSession(input.credentials, extractZaiWebToken);
    const userId = token && userIdFromToken(token);
    if (!token || !userId) return { response: errorResponse(401, "Invalid or expired Z.ai session. Re-import the chat.z.ai session token.", { type: "authentication_error", code: "invalid_session" }), url: COMPLETIONS, headers: {}, transformedBody: redactZaiProof(input.body) };
    const messages = Array.isArray(input.body?.messages) ? input.body.messages : [];
    const proof = resolveZaiCaptchaVerifyParam(input.credentials ?? {}, input.body);
    const hasImages = messages.some((message) => Array.isArray(message.content) && message.content.some((part) => ["image_url", "input_image", "image"].includes(part?.type)));
    // Pinned upstream uses a browser here. No compatible account/proxy-bound browser exists locally.
    if (!proof || hasImages) return { response: errorResponse(400, "Z.ai requires a fresh browser-issued CAPTCHA proof for this account and challenge. Supply captcha_verify_param for a text request; an account/proxy-bound browser transport is unavailable here.", { type: "invalid_request_error", code: "zai_proof_required" }), claudeRequestScoped: true, url: COMPLETIONS, headers: {}, transformedBody: redactZaiProof(input.body) };
    const latest = [...messages].reverse().find((message) => message.role === "user");
    const prompt = isString(latest?.content) ? latest.content : Array.isArray(latest?.content) ? latest.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
    if (!prompt) return { response: errorResponse(400, "Z.ai requires a user message", { type: "invalid_request_error", code: "invalid_request" }), url: COMPLETIONS, headers: {}, transformedBody: redactZaiProof(input.body) };
    const model = String(input.body.model ?? input.model ?? "glm-5.3").split("/").at(-1);
    const chatMessageId = randomUUID();
    const chatBody = { chat: { id: "", title: "New Chat", models: [model], params: {}, history: { messages: { [chatMessageId]: { id: chatMessageId, parentId: null, childrenIds: [], role: "user", content: prompt, timestamp: Math.floor(Date.now() / 1000), models: [model] } }, currentId: chatMessageId }, tags: [], flags: [], features: [], mcp_servers: [], enable_thinking: true, reasoning_effort: input.body.reasoning_effort ?? "max", auto_web_search: false, message_version: 1, extra: {}, timestamp: Date.now(), type: "default" } };
    const sender = createExecutorSender(this, input);
    let upstream = null;
    // Every response returned after the completion send carries its quota ticket.
    const carry = (result) => {
      transferProviderAttemptDispatch(upstream, result.response);
      // Existing request-scoped terminal flag suppresses account/model replay after uncertain work.
      return { ...result, claudeRequestScoped: !result.response.ok, attemptStartedAt: sender.attemptStartedAt };
    };
    try {
      // Creating the empty chat is setup; only the completion is quota-bearing.
      const chatResponse = await sender.sendRequest(NEW_CHAT, { method: "POST", headers: headers(token), body: JSON.stringify(chatBody), redirect: "manual", signal: input.signal }, input.proxyOptions, { quotaBearing: false });
      if (!chatResponse.ok) return carry(await this.upstreamError(chatResponse, input.body, NEW_CHAT));
      const chatId = JSON.parse(await readZaiBody(chatResponse, input.signal)).id;
      input.signal?.throwIfAborted();
      if (!isString(chatId) || !chatId.trim()) throw Object.assign(new Error("Z.ai chat creation returned no id"), { status: 502 });
      const timestamp = Date.now(); const requestId = randomUUID();
      const url = completionUrl(token, userId, requestId, timestamp);
      const payload = { captcha_verify_param: proof, stream: true, model, messages, signature_prompt: prompt, params: {}, extra: {}, features: { preview_mode: true, enable_thinking: true }, variables: {}, chat_id: chatId, id: randomUUID(), current_user_message_id: chatMessageId, current_user_message_parent_id: null, background_tasks: { title_generation: true, tags_generation: true } };
      upstream = await sender.sendRequest(url, { method: "POST", headers: { ...headers(token, "text/event-stream"), "X-FE-Version": FE_VERSION, "X-Signature": signature(prompt, requestId, timestamp, userId) }, body: JSON.stringify(payload), redirect: "manual", signal: input.signal }, input.proxyOptions);
      if (!upstream.ok) return carry(await this.upstreamError(upstream, input.body, COMPLETIONS));
      const answer = await readCompletion(upstream, input.signal);
      const id = `chatcmpl-zai-${timestamp}`; const created = Math.floor(timestamp / 1000);
      const message = { role: "assistant", content: answer.content };
      if (answer.reasoning) message.reasoning_content = answer.reasoning;
      const result = { id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: "stop" }] };
      const response = input.stream ? new Response(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n${answer.reasoning ? `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { reasoning_content: answer.reasoning }, finish_reason: null }] })}\n\n` : ""}data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: answer.content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(result);
      return carry({ response, url: COMPLETIONS, headers: { Authorization: "Bearer [REDACTED]" }, transformedBody: redactZaiProof(input.body) });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (input.signal?.aborted) {
        await settleProviderAttemptDispatch(upstream, { reason: "abort" });
        throw requestAbortError(input.signal.reason);
      }
      const status = [401, 403, 429].includes(error?.status) ? error.status : 502;
      return carry({ response: errorResponse(status, status === 401 || status === 403 ? "Z.ai session expired or was rejected" : status === 429 ? "Z.ai quota exceeded" : "Z.ai request failed; completion was not replayed", { type: status === 401 || status === 403 ? "authentication_error" : "upstream_error", code: `HTTP_${status}` }), url: COMPLETIONS, headers: {}, transformedBody: redactZaiProof(input.body) });
    }
  }

  async upstreamError(response, body, url) {
    const status = (response.status >= 300 && response.status < 400) ? 401 : response.status;
    try { void response.body?.cancel()?.catch(() => {}); } catch { /* already closed */ }
    return { response: errorResponse(status, status === 401 || status === 403 ? "Z.ai session expired or was rejected" : status === 429 ? "Z.ai quota exceeded" : `Z.ai request failed (HTTP ${status})`, { type: status === 401 || status === 403 ? "authentication_error" : "upstream_error", code: `HTTP_${status}` }), url, headers: {}, transformedBody: redactZaiProof(body) };
  }
}

export default ZaiWebExecutor;
