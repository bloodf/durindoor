import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { resolveMaxaiCredential } from "./maxaiCredentials.js";

// Same code as MINIMAX_CODE_OUTCOME_UNKNOWN (minimax-code.js), which singleModel/postProcess.js
// treats as terminal: the send may have been accepted, so it is never replayed.
const OUTCOME_UNKNOWN = "upstream_outcome_unknown";
// Connection failures raised before the request could reach the vendor.
const UNSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "ERR_PROXY_CONNECTION_FAILED"]);
/** True only when the thrown transport error proves the request never left. */
function isUnsentError(error) {
  for (let current = error, depth = 0; depth < 4 && current; depth += 1, current = current.cause) {
    if (isString(current.code) && UNSENT_CODES.has(current.code)) return true;
  }
  return false;
}

const BASE = "https://api.maxai.me";
const PATH = "/gpt/cwc/chat";
const CONFIG_URL = `${BASE}/models/get_config`;
const WEB_APP = "https://www.maxai.co/app/";
let cachedSigningConstants = null;
const fail = (status, message) => Response.json({ error: { message, type: status === 401 || status === 403 ? "authentication_error" : "provider_error" } }, { status });
/**
 * The selected connection's account tuple. See maxaiCredentials.js: a stored cookie
 * header with access_token supplies all three members; otherwise only a complete
 * providerSpecificData tuple is used. Never mixes sources.
 */
const cookieValues = (credentials) => resolveMaxaiCredential(credentials);
async function signingConstants(credentials, fetcher) {
  const saved = credentials?.providerSpecificData?.maxaiSigningConstants;
  if (saved?.hmacKey && saved?.aesKey && saved?.appVersion && saved?.ctxKey) return saved;
  if (cachedSigningConstants) return cachedSigningConstants;
  try {
    const page = await fetcher(WEB_APP, { signal: AbortSignal.timeout(8000), redirect: "manual" });
    if (!page.ok) return null;
    const html = await page.text();
    const paths = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9/_-]+\.js/g)].map((match) => match[0]))];
    const appPath = paths.find((path) => /\/pages\/_app-[a-z0-9]+\.js$/i.test(path));
    if (!appPath) return null;
    const appResponse = await fetcher(`https://www.maxai.co${appPath}`, { signal: AbortSignal.timeout(8000), redirect: "manual" });
    if (!appResponse.ok) return null;
    const app = await appResponse.text();
    const literal = (name) => {
      const variable = app.match(new RegExp(`${name}\\s*:\\s*function\\s*\\(\\)\\s*\\{\\s*return\\s+([A-Za-z_$][\\w$]*)\\s*\\}`))?.[1];
      return variable ? app.match(new RegExp(`\\b${variable}\\s*=\\s*"([^"]+)"`))?.[1] : null;
    };
    let ctxKey = null;
    for (const path of paths.filter((candidate) => /\/chunks\/[A-Za-z0-9]+-[a-z0-9]+\.js$/i.test(candidate)).slice(0, 80)) {
      const response = await fetcher(`https://www.maxai.co${path}`, { signal: AbortSignal.timeout(8000), redirect: "manual" });
      if (!response.ok) continue;
      const source = await response.text();
      if (!/nj\)\("[0-9a-f]+"\)/.test(source)) continue;
      ctxKey = source.match(/"([0-9a-f]{40})"\s*:\s*\{\s*a\s*:/)?.[1];
      if (ctxKey) break;
    }
    const values = { hmacKey: literal("Mn"), aesKey: literal("Rl"), appVersion: app.match(/"(webpage_\d+\.\d+\.\d+)"/)?.[1], ctxKey };
    if (!/^[0-9a-f]{40,}$/.test(values.hmacKey || "") || !/^[0-9a-f]{40,}$/.test(values.aesKey || "") || !values.appVersion || !values.ctxKey) return null;
    cachedSigningConstants = values;
    return values;
  } catch { return null; }
}
async function signedHeaders(path, credentials, auth, fetcher = proxyAwareFetch) {
  if (!auth?.ok) return null;
  const c = await signingConstants(credentials, fetcher);
  if (!c?.hmacKey || !c?.aesKey || !c?.appVersion || !c?.ctxKey) return null;
  const t = Date.now();
  const proof = crypto.createHmac("sha1", `${t}:${c.hmacKey}`).update(`${c.appVersion}:${t}:${path}:${auth.userId}`).digest("hex");
  const p = crypto.createHash("sm3").update(`${t}:${proof}:${c.hmacKey}`).digest("hex");
  const payload = { "X-Client-Domain": "maxai.co", "X-Client-Path": "https://www.maxai.co/app/", "X-Random": String(100000 + Math.floor(Math.random() * 900000)), t, p, d: auth.deviceId, [c.ctxKey]: { a: "" } };
  const salt = crypto.randomBytes(8);
  const magic = Buffer.from("Salted__");
  let derived = Buffer.alloc(0), block = Buffer.alloc(0);
  while (derived.length < 48) { block = crypto.createHash("md5").update(Buffer.concat([block, Buffer.from(c.aesKey), salt])).digest(); derived = Buffer.concat([derived, block]); }
  const cipher = crypto.createCipheriv("aes-256-cbc", derived.subarray(0, 32), derived.subarray(32, 48));
  const sealed = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return { Authorization: `Bearer ${auth.token}`, "X-Authorization": Buffer.concat([magic, salt, sealed]).toString("base64"), "X-App-Version": c.appVersion, "X-Browser-Name": "Firefox", "X-Browser-Version": "150.0", "X-Browser-Major": "150", "X-App-Env": "MaxAI-Browser-Extension", "X-Client-Domain": "maxai.co", "X-Client-Path": "https://www.maxai.co/app/", "X-Random": payload["X-Random"], "Content-Type": "application/json", Accept: "text/event-stream" };
}
export async function validateMaxaiSession(credentials, fetcher = proxyAwareFetch) {
  const auth = cookieValues(credentials);
  if (!auth.ok) return { valid: false, status: null, error: auth.reason === "conflict" ? "MaxAI credentials name more than one account; reconnect the browser session" : "MaxAI access token, device ID and user ID are required" };
  const headers = await signedHeaders("/models/get_config", credentials, auth, fetcher);
  if (!headers) return { valid: false, status: null, error: "MaxAI signing constants are unavailable; reconnect the browser session" };
  const response = await fetcher(CONFIG_URL, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(8000) });
  const result = { valid: response.ok, status: response.status };
  if (!response.ok) result.error = (response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 403 ? "MaxAI session expired" : `MaxAI validation failed (HTTP ${response.status})`;
  return result;
}
function openaiRequest(body, model) {
  const turns = (body.messages || []).map((m) => `${m.role}: ${isString(m.content) ? m.content : JSON.stringify(m.content ?? "")}`).join("\n");
  return { chat_mode: "pro_chat", conversation_id: crypto.randomUUID(), chat_history: [], message_content: [{ type: "text", text: turns }], chrome_extension_version: "webpage", model_name: model, prompt_id: "chat", prompt_name: "chat", prompt_inputs: { RELATED_QUESTION_CNT: "5", AI_RESPONSE_LANGUAGE: "English" }, doc_list: [], event_source: "web", streaming: true, prompt_type: "freestyle", feature_name: "immersive_chat", source_type: "NA", platform_feature: "web_app" };
}
function asOpenAIStream(response, model) {
  if (!response.body) return response;
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  const stream = new ReadableStream({ async pull(controller) { const { value, done } = await reader.read(); if (done) { controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close(); return; } const raw = decoder.decode(value, { stream: true }); const text = raw.replace(/^data:\s*/gm, "").split(/\r?\n/).filter((x) => x && x !== "[DONE]").map((line) => { try { const d = JSON.parse(line); if (d.usage) return `data: ${JSON.stringify({ id: "maxai", object: "chat.completion.chunk", model, choices: [], usage: d.usage })}\n\n`; const content = d.choices?.[0]?.delta?.content ?? d.delta ?? d.text ?? d.content; if (!isString(content)) return ""; return `data: ${JSON.stringify({ id: "maxai", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`; } catch { return ""; } }).join(""); if (text) controller.enqueue(new TextEncoder().encode(text)); }, cancel(reason) { return reader.cancel(reason); } });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
export class MaxaiExecutor extends BaseExecutor {
  constructor(config = {}) { super("maxai", { baseUrl: BASE + PATH, ...config }); }
  buildUrl() { return BASE + PATH; }
  /** Carry the outcome-unknown code of a reset chat send to the account layer; other answers parse as before. */
  parseError(response, bodyText) {
    const parsed = super.parseError(response, bodyText);
    try {
      const error = JSON.parse(bodyText)?.error;
      if (error?.code !== OUTCOME_UNKNOWN || !isString(error.message)) return parsed;
      return { ...parsed, message: error.message, errorBody: { error: { type: error.type, code: error.code, message: error.message } } };
    } catch {
      return parsed;
    }
  }
  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat(input, sender, billed) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = input;
    // Loading the signing constants is not charged; only the chat send is quota-bearing.
    const setup = (url, init) => sender.sendRequest(url, { ...init, signal: signal ? AbortSignal.any([signal, init.signal]) : init.signal }, proxyOptions, { quotaBearing: false });
    // Refuse an incomplete or mixed account tuple before any send, setup loads included.
    const auth = cookieValues(credentials);
    if (!auth.ok) return { response: fail(401, "MaxAI session is missing or expired"), url: this.buildUrl(), headers: {}, transformedBody: null };
    const headers = await signedHeaders(PATH, credentials, auth, setup);
    // The constants loader swallows errors, an abort included.
    if (signal?.aborted) throw requestAbortError(signal.reason);
    if (!headers) return { response: fail(401, "MaxAI session is missing or expired"), url: this.buildUrl(), headers: {}, transformedBody: null };
    let upstream;
    try { upstream = billed(await sender.sendRequest(this.buildUrl(), { method: "POST", headers, body: JSON.stringify(openaiRequest(body || {}, model)), redirect: "manual", signal }, proxyOptions)); }
    catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      const message = error?.message || "MaxAI request failed";
      // The chat POST may have reached MaxAI before the connection failed. Only a connection
      // proven never to have been sent stays an ordinary failure; otherwise the outcome is
      // unknown and singleModel/postProcess.js never replays it.
      const response = isUnsentError(error) ? fail(502, message) : Response.json({ error: { message, type: "provider_error", code: OUTCOME_UNKNOWN } }, { status: 502 });
      return { response, url: this.buildUrl(), headers, transformedBody: body };
    }
    if (upstream.status === 418 || (upstream.status >= 300 && upstream.status < 400)) return { response: fail(401, "MaxAI session expired"), url: this.buildUrl(), headers, transformedBody: body };
    if (upstream.status === 401 || upstream.status === 403) return { response: fail(upstream.status, "MaxAI session expired or rejected"), url: this.buildUrl(), headers, transformedBody: body };
    if (!upstream.ok) return { response: upstream, url: this.buildUrl(), headers, transformedBody: body };
    const response = stream ? asOpenAIStream(upstream, model) : await collectMaxai(upstream, model);
    return { response, url: this.buildUrl(), headers, transformedBody: body };
  }
}
async function collectMaxai(response, model) {
  const text = await response.text(); const fragments = []; let usage;
  for (const line of text.split(/\r?\n/)) { const data = line.replace(/^data:\s*/, ""); if (!data || data === "[DONE]") continue; try { const d = JSON.parse(data); if (d.usage) usage = d.usage; const value = d.choices?.[0]?.delta?.content ?? d.delta ?? d.text ?? d.content; if (isString(value)) fragments.push(value); } catch {} }
  const content = fragments.join("");
  const result = { id: "maxai", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
  if (usage) result.usage = usage;
  return Response.json(result);
}
export { CONFIG_URL as MAXAI_CONFIG_URL };
