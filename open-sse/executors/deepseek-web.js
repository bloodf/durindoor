// DeepSeek request/proof and fragment parity adapted from cheaper-inference/OmniRoute (MIT),
// open-sse/executors/deepseek-web.ts at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
// Copyright and license: ./deepseek-web/LICENSE.omniroute.
import { solveChallenge, POW_TARGET } from "./deepseek-web/pow.js";
import { readBounded, envelopeStatus } from "./deepseek-web/protocol.js";
import { BaseExecutor } from "./base.js";
import { createExecutorSender, cancelDiscardedResponse } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { PROVIDERS } from "../config/providers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const BASE = "https://chat.deepseek.com/api";
const HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: "https://chat.deepseek.com",
  Referer: "https://chat.deepseek.com/",
  "X-Client-Bundle-Id": "com.deepseek.chat",
  "X-Client-Locale": "en-US",
  "X-Client-Platform": "web",
  "X-Client-Version": "2.0.0",
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});

function unwrapToken(raw) {
  if (!isString(raw) || !raw.trim()) return "";
  try {
    const wrapped = JSON.parse(raw);
    if (isString(wrapped?.value)) return wrapped.value.trim();
  } catch { /* raw token */ }
  return raw.trim();
}

/**
 * The web userToken. A pasted API-key value wins; an extension or dashboard import stores the
 * localStorage item as providerSpecificData.userToken. Either form may be the site's JSON wrapper.
 */
export function deepSeekUserToken({ apiKey, providerSpecificData } = {}) {
  return unwrapToken(apiKey) || unwrapToken(providerSpecificData?.userToken);
}

function userToken(credentials) {
  return deepSeekUserToken(credentials ?? {});
}

function promptFrom(messages = []) {
  const usable = messages.map((message) => {
    const role = message.role === "developer" ? "system" : String(message.role || "user");
    const content = isString(message.content)
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((part) => part?.type === "text").map((part) => part.text || "").join(" ")
        : "";
    return { role, content };
  }).filter((message) => message.content.trim());
  const lastUser = usable.findLastIndex((message) => message.role === "user");
  return usable.map((message, index) => index === lastUser ? message.content : `${message.role}: ${message.content}`).join("\n\n");
}

// Fragment decoding adapted from cheaper-inference/OmniRoute (MIT),
// open-sse/executors/deepseek-web.ts at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
// A provider-private parser kept inside its executor. Malformed frames fail closed.
function decodeEvents(text, thinking = false) {
  if (!/(?:\r?\n){2}\s*$/.test(text)) throw new Error("Truncated DeepSeek event record");
  let content = "";
  let reasoning = "";
  let path = thinking ? "thinking" : "content";
  let source = false;
  let legacy = false;
  let nativeFinished = false;
  let legacyFinished = false;
  let done = false;
  const append = value => { if (path === "thinking") reasoning += value; else content += value; };
  const fragment = f => {
    if (!f || !isObject(f) || Array.isArray(f)) throw new Error("Invalid DeepSeek fragment");
    if (f.type !== undefined && !["THINK", "ANSWER", "RESPONSE"].includes(f.type)) throw new Error("Invalid DeepSeek fragment type");
    if (f.type === "THINK") path = "thinking";
    if (f.type === "ANSWER" || f.type === "RESPONSE") path = "content";
    if (f.content !== undefined && !isString(f.content)) throw new Error("Invalid DeepSeek content");
    if (f.content) append(f.content);
  };
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith(":")) continue;
    if (/^(event|id|retry):/.test(raw)) {
      if (/^event:\s*(hint|error)$/.test(raw)) throw new Error("DeepSeek stream rejected");
      continue;
    }
    const data = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
    if (data === "[DONE]") { done = true; continue; }
    if (done) throw new Error("DeepSeek data after terminal");
    const event = JSON.parse(data);
    const status = envelopeStatus(event);
    if (status) throw Object.assign(new Error("DeepSeek rejection"), { status });
    if (event?.error) throw new Error("DeepSeek stream rejected");
    if (!isObject(event) || Array.isArray(event)) throw new Error("Invalid DeepSeek frame");
    const { p, v } = event;
    const searchMetadata = p === "response/search_status" || p === "response/search_results";
    if ((nativeFinished || legacyFinished) && !(nativeFinished && searchMetadata)) throw new Error("DeepSeek data after finish");
    if (searchMetadata) {
      if (p === "response/search_status" ? !isString(v) : !Array.isArray(v)) throw new Error("Invalid DeepSeek search metadata");
      continue;
    }
    if (p !== undefined && !["response/status", "response/fragments", "response"].includes(p) && !/^response\/fragments\/\d+\/content$/.test(p)) throw new Error("Invalid DeepSeek path");
    if (p !== undefined || v !== undefined) source = true;
    if (p === "response/status") {
      if (!isString(v) || /error|fail|abort|cancel/i.test(v)) throw new Error("DeepSeek status rejected");
      if (v === "FINISHED") nativeFinished = true;
      continue;
    }
    if (v?.response) {
      if (!isObject(v.response) || Array.isArray(v.response) ||
          (v.response.thinking_enabled !== undefined && ![true, false].includes(v.response.thinking_enabled)) ||
          (v.response.fragments !== undefined && !Array.isArray(v.response.fragments))) throw new Error("Invalid DeepSeek response");
      if (v.response.thinking_enabled !== undefined) path = v.response.thinking_enabled ? "thinking" : "content";
      if (Array.isArray(v.response.fragments)) v.response.fragments.forEach(fragment);
    } else if (p === "response/fragments") {
      (Array.isArray(v) ? v : [v]).forEach(fragment);
    } else if (isString(v) && !p?.startsWith("response/search")) append(v);
    else if (p === "response" && Array.isArray(v)) {
      for (const entry of v) {
        if (!isObject(entry) || (!Array.isArray(entry.v) && !isObject(entry.v))) throw new Error("Invalid DeepSeek batch");
        if (entry?.v?.thinking_enabled === true) path = "thinking";
        if (Array.isArray(entry?.v)) entry.v.forEach(fragment);
      }
    }
    if (v !== undefined && !isString(v) && !v?.response && p !== "response/fragments" && !(p === "response" && Array.isArray(v))) throw new Error("Invalid DeepSeek source value");
    const choice = event?.choices?.[0];
    if (choice?.delta) {
      if (!isObject(choice.delta) || Array.isArray(choice.delta) ||
          [choice.delta.content, choice.delta.reasoning_content].some(value => value != null && !isString(value))) throw new Error("Invalid DeepSeek delta");
      if (choice.finish_reason != null) {
        if (!["stop", "length", "tool_calls", "content_filter"].includes(choice.finish_reason)) throw new Error("Invalid DeepSeek finish");
        legacyFinished = true;
      }
      legacy = true;
      content += choice.delta.content || "";
      reasoning += choice.delta.reasoning_content || "";
    }
    if (event.choices !== undefined && (!Array.isArray(event.choices) || event.choices.length !== 1 || !choice?.delta)) throw new Error("Invalid DeepSeek choices");
    const payload = event?.data?.biz_data || event?.biz_data || event?.data;
    const value = payload?.response || payload?.content || payload?.message?.content;
    if (isString(value)) { content += value; legacy = true; }
    if (p === undefined && v === undefined && !choice?.delta && !isString(value)) throw new Error("Unrecognized DeepSeek frame");
  }
  // EOF never proves completion. Native and legacy dialects cannot share a response.
  if (source && legacy) throw new Error("Mixed DeepSeek stream dialects");
  if (source ? !nativeFinished : !legacy || !(legacyFinished || done)) {
    throw new Error("DeepSeek stream ended before completion");
  }
  if (!content && !reasoning) throw new Error("Empty DeepSeek completion");
  return { content, reasoning };
}

/**
 * Resolve DeepSeek Web mode and feature flags from the model id and request body.
 * Pro, Expert, Reasoner, and R1 models route through `"expert"` mode, while
 * Flash and base chat stay on `"default"` (upstream decolua/9router#3945).
 *
 * @param {string} model Requested model id.
 * @param {object} [body] Incoming OpenAI-format request body.
 * @returns {{ modelType: "expert" | "default", thinkingEnabled: boolean, searchEnabled: boolean }}
 */
export function resolveDeepSeekWebModelOptions(model, body) {
  const lower = String(model || "").toLowerCase();
  return {
    modelType: /pro|expert|reason|r1/.test(lower) ? "expert" : "default",
    thinkingEnabled: /think|reason|r1/.test(lower) || body?.thinking === true || body?.reasoning_effort != null,
    searchEnabled: /search/.test(lower) || body?.search === true || body?.web_search === true,
  };
}

/** Source proof is mandatory on every completion; legacy environment flags cannot bypass it. */
export function deepSeekWebProofOfWorkEnabled() {
  return true;
}

/**
 * Every completion requires a bounded source proof on the selected account/route.
 * Native FINISHED or a valid legacy finish/DONE is required before publishing success;
 * uncertain billable outcomes are terminal and cannot be replayed across accounts.
 * Verification is mocked/offline only; it does not establish live provider parity.
 */
export class DeepSeekWebExecutor extends BaseExecutor {
  constructor() { super("deepseek-web", PROVIDERS["deepseek-web"]); }

  shouldRefreshAfterAuthFailure() { return false; }

  async execute(input) {
    const { model, body, stream, credentials, proxyOptions = null } = input;
    const deadline = AbortSignal.timeout(60_000);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    const sender = createExecutorSender(this, { ...input, signal });
    const token = userToken(credentials);
    if (!token) return { response: json({ error: { message: "DeepSeek Web requires a web userToken from local storage", type: "authentication_error", code: "HTTP_401" } }, 401), url: `${BASE}/v0/chat/completion`, headers: {}, transformedBody: body };
    const prompt = promptFrom(body?.messages);
    if (!prompt) return { response: json({ error: { message: "A non-empty user message is required", type: "invalid_request_error" } }, 400), url: `${BASE}/v0/chat/completion`, headers: {}, transformedBody: body };
    const common = { ...HEADERS, Authorization: `Bearer ${token}` };
    const sessionRejected = (url, headers) => ({ response: json({ error: { message: "DeepSeek web session was rejected", type: "authentication_error", code: "HTTP_401" } }, 401), url, headers, transformedBody: body });
    // The user and session requests are setup; only the completion is quota-bearing.
    // This executor sends through the patched global fetch, which routes `proxyOptions`.
    const send = (url, init) => sender.sendRequest(url, init, proxyOptions, { quotaBearing: false, globalFetch: true });
    const post = (url, payload, headers) => sender.sendRequest(url, { method: "POST", headers, noTransportReplay: true, body: JSON.stringify(payload), redirect: "manual", signal }, proxyOptions, { globalFetch: true });
    let completion;
    let outcomeUnknown = false;
    // Every result after the completion send carries its quota ticket.
    const carry = (result) => {
      transferProviderAttemptDispatch(completion, result.response);
      // Existing request-scoped terminal contract is honored by chatCore and
      // account fallback for both client dialects. Never replay uncertain work.
      if (outcomeUnknown && !result.response.ok) result.response.upstreamPartialOutput = true;
      return { ...result, claudeRequestScoped: outcomeUnknown && !result.response.ok, attemptStartedAt: sender.attemptStartedAt };
    };
    try {
      const current = await send(`${BASE}/v0/users/current`, { headers: common, redirect: "manual", signal });
      if (!current.ok) cancelDiscardedResponse(current);
      if (current.status >= 300 && current.status < 400) return sessionRejected(`${BASE}/v0/users/current`, common);
      if (!current.ok) return { response: json({ error: { message: current.status === 401 || current.status === 403 ? "DeepSeek web userToken is invalid or expired" : `DeepSeek users/current returned HTTP ${current.status}`, type: "upstream_error", code: `HTTP_${current.status}` } }, current.status), url: `${BASE}/v0/users/current`, headers: common, transformedBody: body };
      const currentData = JSON.parse(await readBounded(current, signal, 64 * 1024));
      if (envelopeStatus(currentData)) return sessionRejected(`${BASE}/v0/users/current`, common);
      const accessToken = currentData?.data?.biz_data?.token || currentData?.biz_data?.token;
      if (!isString(accessToken) || !accessToken || accessToken.length > 8192 || /[^\x21-\x7e]/.test(accessToken)) return { response: json({ error: { message: "DeepSeek did not return an access token for this userToken", type: "upstream_error", code: "HTTP_401" } }, 401), url: `${BASE}/v0/users/current`, headers: common, transformedBody: body };
      const authHeaders = { ...HEADERS, Authorization: `Bearer ${accessToken}` };
      const sessionResponse = await send(`${BASE}/v0/chat_session/create`, { method: "POST", headers: { ...authHeaders, Cookie: "intercom-HWWAFSESTIME=0; HWWAFSESTIME=0" }, body: "{}", redirect: "manual", signal });
      if (!sessionResponse.ok) cancelDiscardedResponse(sessionResponse);
      if (sessionResponse.status >= 300 && sessionResponse.status < 400) return sessionRejected(`${BASE}/v0/chat_session/create`, authHeaders);
      if (!sessionResponse.ok) return { response: json({ error: { message: `DeepSeek session creation returned HTTP ${sessionResponse.status}`, type: "upstream_error", code: `HTTP_${sessionResponse.status}` } }, sessionResponse.status), url: `${BASE}/v0/chat_session/create`, headers: authHeaders, transformedBody: body };
      const sessionData = JSON.parse(await readBounded(sessionResponse, signal, 64 * 1024));
      if (envelopeStatus(sessionData)) return sessionRejected(`${BASE}/v0/chat_session/create`, authHeaders);
      const sessionId = sessionData?.data?.biz_data?.chat_session?.id || sessionData?.biz_data?.chat_session?.id;
      if (!isString(sessionId) || !sessionId || sessionId.length > 8192) return { response: json({ error: { message: "DeepSeek did not return a chat session id", type: "upstream_error" } }, 502), url: `${BASE}/v0/chat_session/create`, headers: authHeaders, transformedBody: body };
      const modelId = String(model || "deepseek-chat");
      const { modelType, thinkingEnabled, searchEnabled } = resolveDeepSeekWebModelOptions(modelId, body);
      const payload = {
        chat_session_id: sessionId,
        parent_message_id: null,
        model_type: modelType,
        prompt,
        ref_file_ids: [],
        thinking_enabled: thinkingEnabled,
        search_enabled: searchEnabled,
        preempt: false,
      };
      // Challenge reads are unbilled, use the selected route, and never retry a submit.
      const proofHeaders = {};
      {
        const challengeResponse = await send(`${BASE}/v0/chat/create_pow_challenge`, {
          method: "POST", headers: authHeaders, body: JSON.stringify({ target_path: POW_TARGET }), redirect: "manual", signal,
        });
        if (!challengeResponse.ok) cancelDiscardedResponse(challengeResponse);
        if (!challengeResponse.ok) throw Object.assign(new Error("DeepSeek challenge refused"), {
          status: challengeResponse.status === 401 || challengeResponse.status === 403 ? 401 : challengeResponse.status === 429 ? 429 : 502,
        });
        const challengeData = JSON.parse(await readBounded(challengeResponse, signal, 64 * 1024));
        const challengeStatus = envelopeStatus(challengeData);
        if (challengeStatus) throw Object.assign(new Error("DeepSeek challenge refused"), { status: challengeStatus });
        const challenge = challengeData?.data?.biz_data?.challenge ?? challengeData?.biz_data?.challenge;
        proofHeaders["X-Ds-Pow-Response"] = await solveChallenge({ ...challenge, target_path: POW_TARGET }, { signal });
      }
      signal.throwIfAborted();
      outcomeUnknown = true;
      completion = await post(`${BASE}/v0/chat/completion`, payload, { ...authHeaders, ...proofHeaders, Cookie: "intercom-HWWAFSESTIME=0; HWWAFSESTIME=0" });
      if (!completion.ok) cancelDiscardedResponse(completion);
      if (completion.status >= 300 && completion.status < 400) return carry(sessionRejected(`${BASE}/v0/chat/completion`, authHeaders));
      if (!completion.ok) {
        outcomeUnknown = ![401, 403, 429].includes(completion.status);
        const status = completion.status === 401 || completion.status === 403 ? 401 : completion.status === 429 ? 429 : completion.status;
        const message = status === 401 ? "DeepSeek web session expired or is unauthorized" : status === 429 ? "DeepSeek web quota or rate limit reached" : `DeepSeek completion returned HTTP ${completion.status}`;
        return carry({ response: json({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }, status), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload });
      }
      const responseText = await readBounded(completion, signal);
      if (completion.headers.get("content-type")?.includes("application/json")) {
        const rejection = envelopeStatus(JSON.parse(responseText));
        if (rejection) outcomeUnknown = false;
        const status = rejection || 502;
        throw Object.assign(new Error("DeepSeek completion refused"), { status });
      }
      const result = decodeEvents(responseText, thinkingEnabled);
      signal.throwIfAborted();
      const cid = `chatcmpl-dsweb-${crypto.randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const message = { role: "assistant", content: result.content };
      if (result.reasoning) message.reasoning_content = result.reasoning;
      if (!stream) return carry({ response: json({ id: cid, object: "chat.completion", created, model: modelId, choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload });
      const chunks = [{ role: "assistant" }, ...(result.reasoning ? [{ reasoning_content: result.reasoning }] : []), ...(result.content ? [{ content: result.content }] : []), {}];
      const sse = chunks.map((delta, index) => `data: ${JSON.stringify({ id: cid, object: "chat.completion.chunk", created, model: modelId, choices: [{ index: 0, delta, finish_reason: index === chunks.length - 1 ? "stop" : null }] })}\n\n`).join("") + "data: [DONE]\n\n";
      return carry({ response: new Response(sse, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }), url: `${BASE}/v0/chat/completion`, headers: authHeaders, transformedBody: payload });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      const status = input.signal?.aborted ? 499 : deadline.aborted ? 504 : [401, 429].includes(error?.status) ? error.status : 502;
      return carry({ response: json({ error: { message: status === 401 ? "DeepSeek web session expired or is unauthorized" : status === 429 ? "DeepSeek web quota or rate limit reached" : status === 499 ? "DeepSeek Web request aborted" : status === 504 ? "DeepSeek Web request deadline exceeded" : "DeepSeek Web request failed", type: "upstream_error", code: `HTTP_${status}` } }, status), url: `${BASE}/v0/chat/completion`, headers: common, transformedBody: body });
    }
  }
}

export default DeepSeekWebExecutor;
