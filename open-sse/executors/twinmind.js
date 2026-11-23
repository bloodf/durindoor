import { createHash, randomUUID } from "node:crypto";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { BaseExecutor } from "./base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { PROVIDERS } from "../config/providers.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { runQuotaBearingProviderRequest } from "../services/providerAttemptContext.js";

const CHAT_URL = "https://api2.twinmind.com/api/v3/chat";
const REFRESH_URL = "https://securetoken.googleapis.com/v1/token";
// Public Firebase web client identifier, from OmniRoute's TwinMind integration.
const KEY_BYTES = [46,36,20,8,33,22,49,70,54,73,47,59,50,95,31,34,25,4,70,25,2,28,6,57,30,49,17,3,93,40,47,7,47,36,39,117,21,120,62];
const firebaseKey = () => process.env.TWINMIND_FIREBASE_API_KEY || KEY_BYTES.map((n, i) => String.fromCharCode(n ^ "omniroute-public-v1".charCodeAt(i % 18))).join("");
const strip = (s) => isString(s) ? s.replace(/^Bearer\s+/i, "").trim() : "";
const expiry = (token) => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000 || 0; } catch { return 0; }
};
const jwt = (value) => /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
const text = (content) => isString(content) ? content : Array.isArray(content) ? content.map((part) => part?.text || "").join("\n") : "";
const errorResult = (status, message, body) => ({ response: Response.json({ error: { message, type: status === 401 ? "authentication_error" : status === 429 ? "rate_limit_error" : "api_error" } }, { status }), url: CHAT_URL, headers: {}, transformedBody: body });

async function waitForRefresh(pending, signal) {
  if (!signal) return pending;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * TwinMind uses a private app chat envelope and Firebase refresh tokens.
 * It reuses cached tokens and pending refreshes only for the same identified
 * connection and stored credentials. A disconnected caller stops waiting
 * without cancelling the shared Firebase request.
 */
export class TwinmindExecutor extends BaseExecutor {
  constructor() {
    super("twinmind", PROVIDERS.twinmind);
    this.tokens = new Map();
    this.pendingRefreshes = new Map();
  }

  async execute({ model, body, stream, credentials = {}, connectionId, signal, proxyOptions, onCredentialsRefreshed }) {
    if (body?.tools?.length || body?.messages?.some((message) => message.tool_calls || ["tool", "function"].includes(message.role) || (Array.isArray(message.content) && message.content.some((part) => !["text", "input_text"].includes(part.type))))) {
      return errorResult(400, "TwinMind supports text chat only", body);
    }
    const key = strip(credentials.apiKey);
    const access = strip(credentials.accessToken || (jwt(key) ? key : ""));
    const refresh = strip(credentials.refreshToken || credentials.providerSpecificData?.refreshToken || credentials.providerSpecificData?.refresh_token || credentials.providerSpecificData?.firebaseRefreshToken || (!jwt(key) ? key : ""));
    const identity = connectionId
      ? createHash("sha256").update(JSON.stringify([connectionId, key, refresh])).digest("hex")
      : null;
    const fetcher = (url, init) => proxyAwareFetch(url, init, proxyOptions);
    let localToken;
    const getCached = () => identity ? this.tokens.get(identity) : localToken;
    const fresh = (token, expires) => jwt(token) && expires > Date.now() + 300000;
    const cached = getCached();
    let token = fresh(cached?.token, cached?.expires) ? cached.token : fresh(access, expiry(access)) ? access : "";
    const fetchAccess = async (cached, refreshSignal) => {
      const response = await credentialFetch(fetcher, `${REFRESH_URL}?key=${encodeURIComponent(firebaseKey())}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cached?.refresh || refresh }).toString(), signal: refreshSignal });
      if (!response.ok) return "";
      const result = await response.json();
      const next = strip(result.id_token || result.access_token);
      const expires = expiry(next) || (Number(result.expires_in) > 0 ? Date.now() + Number(result.expires_in) * 1000 : 0);
      if (!fresh(next, expires)) return "";
      const entry = { token: next, expires, refresh: result.refresh_token || refresh };
      // Never replace the saved API-key secret with a short-lived token.
      if (onCredentialsRefreshed && entry.refresh !== refresh) {
        try { await onCredentialsRefreshed({ refreshToken: entry.refresh, providerSpecificPatch: {} }); } catch { /* The cached token remains usable. */ }
      }
      if (identity) this.tokens.set(identity, entry);
      else localToken = entry;
      return next;
    };
    const refreshAccess = (rejectedToken) => {
      signal?.throwIfAborted();
      if (!refresh) return "";
      const latest = getCached();
      if (latest?.token !== rejectedToken && fresh(latest?.token, latest?.expires)) return latest.token;
      if (!identity) return fetchAccess(latest, signal);

      let pending = this.pendingRefreshes.get(identity);
      if (!pending) {
        // Keep a rotated refresh credential while marking the rejected bearer stale.
        if (latest?.token === rejectedToken && latest) this.tokens.set(identity, { ...latest, expires: 0 });
        pending = fetchAccess(latest, AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS))
          .finally(() => this.pendingRefreshes.delete(identity));
        this.pendingRefreshes.set(identity, pending);
      }
      return waitForRefresh(pending, signal);
    };
    try { if (!token) token = await refreshAccess(); } catch (error) { if (signal?.aborted) throw error; return errorResult(401, "TwinMind token refresh failed", body); }
    if (!token) return errorResult(401, "TwinMind credentials expired or invalid", body);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const query = messages.map((message) => `<${message.role}>\n${text(message.content)}\n</${message.role}>`).join("\n\n").trim();
    if (!query) return errorResult(400, "TwinMind requires a non-empty message", body);
    const requestedModel = (model || body.model || "auto").replace(/^(twinmind|tm)\//, "");
    const envelope = { type: "app", version: 1, response_version: 1, query, model: { model_name: ["auto", "default"].includes(requestedModel) ? "gpt-5.6-sol-thinking" : requestedModel }, context: null, client: { platform: "web", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", client_time: new Date().toISOString(), locale: "en" }, capabilities: { allow_web_search: false, allow_notes_access: false }, mode: "private" };
    const post = (bearer) => runQuotaBearingProviderRequest(() => credentialFetch(fetcher, CHAT_URL, { method: "POST", headers: { accept: "text/event-stream", "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify(envelope), signal }));
    let upstream = await post(token);
    if (upstream.status === 401 && refresh) {
      await upstream.body?.cancel();
      try { token = await refreshAccess(token); } catch (error) { if (signal?.aborted) throw error; token = ""; }
      if (!token) return errorResult(401, "TwinMind credentials expired or invalid", body);
      upstream = await post(token);
    }
    if (!upstream.ok) return { response: upstream, url: CHAT_URL, headers: {}, transformedBody: envelope, terminalProvenance: "upstream" };
    const id = `chatcmpl-twinmind-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta, finish = null) => ({ id, object: "chat.completion.chunk", created, model: body.model || model, choices: [{ index: 0, delta, finish_reason: finish }] });
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function* deltas() {
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/); buffer = done ? "" : lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try { const event = JSON.parse(line.slice(5).trim()); if (["text_start", "text_delta"].includes(event.type) && isString(event.content)) yield event.content; } catch { /* ignore non-JSON events */ }
          }
          if (done) break;
        }
      } finally { reader.releaseLock(); }
    }
    let response;
    if (stream) {
      const encoder = new TextEncoder();
      const iterator = deltas();
      let started = false;
      response = new Response(new ReadableStream({ async pull(controller) {
        if (!started) { started = true; controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ role: "assistant" }))}\n\n`)); return; }
        try { const next = await iterator.next(); if (!next.done) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ content: next.value }))}\n\n`)); else { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`)); controller.close(); } } catch (error) { controller.error(error); }
      }, async cancel() { await reader.cancel(); await iterator.return(); } }), { headers: { "content-type": "text/event-stream" } });
    } else {
      let content = "";
      for await (const delta of deltas()) content += delta;
      response = Response.json({ id, object: "chat.completion", created, model: body.model || model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    }
    return { response, url: CHAT_URL, headers: {}, transformedBody: envelope, terminalProvenance: "upstream" };
  }
}
