import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { tlsFetchLMArena } from "../services/lmarenaTlsClient.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const URL = "https://arena.ai/nextjs-api/stream/create-evaluation";
const ALLOW = { "amazon.nova-pro-v1:0": "a14546b5-d78d-4cf6-bb61-ab5b8510a9d6", "claude-haiku-4-5-20251001": "0199e8e9-01ed-73e0-96ba-cf43b286bf10", "claude-sonnet-5": "019f19f2-41f1-7c6d-9891-48d02fd9952c", "gemini-3.1-pro-preview": "019c7820-5480-78b6-9fef-04c0d7004054", "gpt-5.2-high": "019b1449-0313-7911-b836-419e2ed79b2e", "gpt-oss-120b": "6ee9f901-17b5-4fbe-9cc2-13c16497c23b" };
function cookieOf(c) { return c?.cookie || c?.apiKey || c?.providerSpecificData?.cookie || ""; }
const error = (status, message) => Response.json({ error: { message, type: status === 401 || status === 403 ? "authentication_error" : "provider_error" } }, { status });
export async function validateLmarenaSession(credentials, fetcher = tlsFetchLMArena) {
  const cookie = cookieOf(credentials); if (!cookie) return { valid: false, status: null, error: "Arena session cookie is required" };
  const result = await fetcher(URL, { method: "GET", headers: { Cookie: cookie, Accept: "application/json" }, stream: false });
  const status = result.status;
  if (status === 401 || status === 403) return { valid: false, status, error: "Arena session expired" };
  // A 405 from the live endpoint confirms the host and route; authenticated
  // chat calls remain the definitive session check because Arena has no whoami API.
  if (status === 405 || (status >= 200 && status < 300)) return { valid: true, status };
  return { valid: false, status, error: `Arena validation failed (HTTP ${status})` };
}
function prompt(messages) { return (messages || []).map((m) => `${m.role || "user"}: ${isString(m.content) ? m.content : JSON.stringify(m.content || "")}`).join("\n"); }
function upstreamBody(model, messages, body) { const request = { id: crypto.randomUUID(), mode: "direct-battle", modelAId: ALLOW[model] || model, userMessageId: crypto.randomUUID(), modelAMessageId: crypto.randomUUID(), userMessage: { content: prompt(messages), experimental_attachments: [], metadata: {} }, modality: "chat" }; const recaptcha = body?.providerSpecificData?.recaptchaV3Token; if (isString(recaptcha) && recaptcha) request.recaptchaV3Token = recaptcha; return request; }
function openAIStream(source, model) {
  if (!source) return null; const reader = source.getReader(); const decoder = new TextDecoder();
  return new ReadableStream({ async pull(controller) { const { value, done } = await reader.read(); if (done) { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close(); return; } const raw = decoder.decode(value, { stream: true }); for (const line of raw.split(/\r?\n/)) { const d = line.replace(/^data:\s*/, ""); if (!d || d === "[DONE]") continue; let content, usage; try { const parsed = JSON.parse(d); content = parsed.text ?? parsed.delta?.text ?? parsed.content ?? parsed.message?.content; usage = parsed.usage; } catch { content = d; } const chunk = usage ? { id: "lmarena", object: "chat.completion.chunk", model, choices: [], usage } : { id: "lmarena", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: isString(content) ? content : "" }, finish_reason: null }] }; if (isString(content) && content || usage) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`)); } }, cancel(reason) { return reader.cancel(reason); } });
}
export class LmarenaExecutor extends BaseExecutor {
  constructor(config = {}) { super("lmarena", { baseUrl: URL, ...config }); }
  buildUrl() { return URL; }
  async execute(input) {
    const { model, body, stream, credentials, signal } = input; const cookie = cookieOf(credentials);
    if (!cookie) return { response: error(401, "Arena session cookie is missing"), url: URL, headers: {}, transformedBody: null };
    const headers = { "Content-Type": "application/json", Accept: "text/event-stream", Origin: "https://arena.ai", Referer: "https://arena.ai/", Cookie: cookie };
    const result = await tlsFetchLMArena(URL, { method: "POST", headers, body: JSON.stringify(upstreamBody(model, body?.messages, credentials)), signal, stream: !!stream });
    if (result.status >= 400) return { response: error(result.status, result.text || `Arena returned HTTP ${result.status}`), url: URL, headers, transformedBody: body };
    const upstream = new Response(result.text || "", { status: result.status, headers: { "content-type": "text/event-stream" } });
    if (stream) return { response: new Response(openAIStream(result.body || result.response?.body, model), { status: 200, headers: { "content-type": "text/event-stream" } }), url: URL, headers, transformedBody: body };
    const text = result.text || await upstream.text(); let usage;
    const answer = text.split(/\r?\n/).map((line) => line.replace(/^data:\s*/, "")).filter(Boolean).map((line) => { try { const x = JSON.parse(line); if (x.usage) usage = x.usage; return x.text ?? x.delta?.text ?? x.content ?? ""; } catch { return ""; } }).join("");
    const completion = { id: "lmarena", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }] };
    if (usage) completion.usage = usage;
    return { response: Response.json(completion), url: URL, headers, transformedBody: body };
  }
}
export { URL as LMARENA_CHAT_URL };
