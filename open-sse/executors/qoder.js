/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's COSY-signed
 * inference endpoint at api3.qoder.sh, then unwraps Qoder's `{statusCodeValue,
 * body}` SSE envelope back into plain OpenAI SSE for the rest of the pipeline.
 *
 * Differences vs the previous placeholder:
 *   - URL is api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation
 *     with `&Encode=1` so we can ship the body through the WAF-bypass
 *     encoder.
 *   - Authentication is COSY (RSA + AES + MD5 + ~17 Cosy-* headers), not
 *     a static HMAC.
 *   - The request shape Qoder expects is non-trivial (chat_context with
 *     mirrored modelConfig, business block with stable IDs, system text
 *     hoisted out of the messages array). All ported from the reference.
 *   - Model identifier is one of the canonical Qoder keys (auto / ultimate /
 *     performance / efficient / lite + frontier "*model" ids); the
 *     translator layer feeds us "qoder/<key>" so we strip the prefix.
 *   - Per-model `model_config` is fetched live from /algo/api/v2/model/list
 *     and cached. Sending the wrong block silently downgrades to a
 *     different model upstream, so a missing entry is a hard error.
 */

import { qoderEncodeBody } from "../shared/qoder/encoding.js";
import { buildCosyHeaders } from "../shared/qoder/cosy.js";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { sanitizeErrorMessage } from "../utils/error.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { FORMATS } from "../translator/formats.js";
import { createUpstreamTerminalTracker } from "../utils/streamTerminal.js";
import {
  getCurrentProviderAttemptTimestamp,
  runQuotaBearingProviderRequest } from
"../services/providerAttemptContext.js";
import {
  QODER_CHAT_URL_ENCODED,
  QODER_JOB_TOKEN_EXCHANGE_URL,
  QODER_USERINFO_URL,
  QODER_MODEL_MAP,
  QODER_IDE_VERSION,
  QODER_CLIENT_TYPE } from
"../shared/qoder/constants.js";
import { getQoderModelConfig, resolveQoderModels } from "../services/qoderModels.js";

/**
 * Hoist role:"system" messages out of the messages array (Qoder rejects
 * system in messages) and flatten any multipart content arrays.
 */
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "" };
  }
  const systemParts = [];
  const out = [];
  for (const msg of messages) {
    if (!msg || !isObject(msg)) continue;
    const text = extractText(msg.content);
    if (msg.role === "system") {
      if (text) systemParts.push(text);
      continue;
    }
    const cloned = { ...msg };
    cloned.content = text;
    out.push(cloned);
  }
  return { messages: out, systemText: systemParts.join("\n\n") };
}

function extractText(content) {
  if (isString(content)) return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && isObject(item)) {
        if (item.type === "text" && isString(item.text)) {
          parts.push(item.text);
        } else if (isString(item.text)) {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && isString(m.content)) {
      return m.content;
    }
  }
  return "";
}

function stableHash(prefix, ...parts) {
  const h = createHash("sha256");
  h.update(prefix);
  for (const p of parts) {
    h.update("\0");
    h.update(String(p ?? ""));
  }
  return h.digest("hex").slice(0, 16);
}

function stableChatRecordId(model, messages, tools, maxTokens) {
  const h = createHash("sha256");
  h.update("qoder-record\0");
  h.update(String(model));
  for (const m of messages) {
    if (!m || !isObject(m)) continue;
    if (m.role) {h.update("\0");h.update(m.role);}
    if (isString(m.content) && m.content) {
      h.update("\0");h.update(m.content);
    }
  }
  if (tools) {
    h.update("\0");
    try {h.update(JSON.stringify(tools));} catch {}
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

/**
 * Map the OpenAI-style request body into the exact shape Qoder expects.
 */
async function buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal }) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");

  // Fetch model config from dynamic API instead of relying on static QODER_MODEL_MAP.
  // This allows support for new Qoder models (e.g., qmodel_latest) without code changes.
  let modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal });
  if (!modelConfig) {
    // Try a forced refresh once before giving up — the cache may simply
    // not be populated yet on first ever call for this credential.
    const refreshed = await resolveQoderModels(credentials, { forceRefresh: true, log, proxyOptions, signal });
    const retried = refreshed?.rawConfigs.get(qoderKey);
    if (!retried) {
      throw new Error(
        `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`
      );
    }
    modelConfig = { ...retried, key: qoderKey };
  }

  const { messages, systemText } = normalizeMessages(body.messages || []);
  const tools = body.tools;
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (isNumber(body.max_tokens) && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (isNumber(body.max_completion_tokens) && body.max_completion_tokens > 0 && body.max_completion_tokens < maxTokens) {
    maxTokens = body.max_completion_tokens;
  }

  const lastUser = lastUserText(messages);
  const psd = credentials.providerSpecificData || {};
  const sessionId = stableHash("qoder-session", psd.userId, qoderKey);
  const recordId = stableChatRecordId(qoderKey, messages, tools, maxTokens);

  return {
    qoderKey,
    payload: {
      request_id: uuidv4(),
      request_set_id: recordId,
      chat_record_id: recordId,
      session_id: sessionId,
      stream: true,
      chat_task: "FREE_INPUT",
      is_reply: true,
      is_retry: false,
      source: 1,
      version: "3",
      session_type: "qodercli",
      agent_id: "agent_common",
      task_id: "common",
      code_language: "",
      chat_prompt: "",
      image_urls: null,
      aliyun_user_type: "",
      system: systemText,
      messages,
      tools: Array.isArray(tools) ? tools : [],
      parameters: { max_tokens: maxTokens },
      chat_context: {
        chatPrompt: "",
        imageUrls: null,
        extra: {
          context: [],
          modelConfig: { key: qoderKey, is_reasoning: isReasoning },
          originalContent: lastUser
        },
        features: [],
        text: lastUser
      },
      model_config: modelConfig,
      business: {
        product: "cli",
        version: "1.0.0",
        type: "agent",
        stage: "start",
        id: uuidv4(),
        name: truncate(lastUser, 30),
        begin_at: Date.now()
      }
    },
    modelConfig
  };
}

// Never inspect beyond a small stream prefix. Prefix chunks are replayed
// byte-for-byte when they are not a billing response.
const QODER_SSE_PEEK_BYTES = 64 * 1024;

/**
 * Match only Qoder's top-level permanent-quota code. Auth persistence reuses
 * this predicate so provider-controlled message text cannot widen the trigger.
 */
export function isQoderQuotaExhaustedBody(body) {
  let parsed = body;
  if (isString(body)) {
    if (!body) return false;
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
  }
  return parsed && isObject(parsed) && !Array.isArray(parsed) &&
  parsed.code === "112";
}

function isBillingBlock(body) {
  if (!isString(body) || !body) return false;
  try {
    const parsed = JSON.parse(body);
    return isQoderQuotaExhaustedBody(parsed) ||
    parsed && isObject(parsed) && !Array.isArray(parsed) && (
    parsed.code === "10605" || Object.hasOwn(parsed, "pricingUrl"));
  } catch {
    return false;
  }
}

function releaseReader(reader) {
  try {reader.releaseLock();} catch {/* already released */}
}

async function cancelAndReleaseReader(reader, reason) {
  let timer;
  try {
    await Promise.race([
    Promise.resolve(reader.cancel(reason)).catch(() => {}),
    new Promise((resolve) => {timer = setTimeout(resolve, 250);})]
    );
  } finally {
    clearTimeout(timer);
    releaseReader(reader);
  }
}

function qoderPeekTimeoutError() {
  const error = new Error("qoder stream-start timeout");
  error.name = "TimeoutError";
  return error;
}

async function readBeforeDeadline(reader, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw qoderPeekTimeoutError();
  let timer;
  try {
    return await Promise.race([
    reader.read(),
    new Promise((_, reject) => {timer = setTimeout(() => reject(qoderPeekTimeoutError()), remaining);})]
    );
  } finally {
    clearTimeout(timer);
  }
}

async function peekQoderBillingFrame(reader, timeoutMs) {
  const decoder = new TextDecoder();
  const chunks = [];
  const deadlineAt = Date.now() + timeoutMs;
  let text = "";
  let bytes = 0;

  try {
    while (bytes < QODER_SSE_PEEK_BYTES) {
      const { done, value } = await readBeforeDeadline(reader, deadlineAt);
      if (done) {
        releaseReader(reader);
        return { chunks, done: true };
      }
      chunks.push(value);
      const inspectBytes = Math.min(value.byteLength, QODER_SSE_PEEK_BYTES - bytes);
      bytes += inspectBytes;
      text += decoder.decode(value.subarray(0, inspectBytes), { stream: true });

      let newline;
      while ((newline = text.indexOf("\n")) !== -1) {
        const line = text.slice(0, newline).replace(/\r$/, "").trim();
        text = text.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const envelope = JSON.parse(line.slice(5).trimStart());
          const status = isNumber(envelope.statusCodeValue) ? envelope.statusCodeValue : 200;
          const body = isString(envelope.body) ? envelope.body : "";
          if (status !== 200 && isBillingBlock(body)) return { chunks, done: false, billing: { status, body } };
        } catch {

          // Malformed frames remain existing stream-transform failures.
        }
        return { chunks, done: false };
      }
    }
    return { chunks, done: false };
  } catch (error) {
    await cancelAndReleaseReader(reader, error);
    throw error;
  }
}

function replayQoderBody(reader, chunks, alreadyDone) {
  let index = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    releaseReader(reader);
  };
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (alreadyDone) {
        finish();
        controller.close();
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      try {await reader.cancel(reason);} finally {releaseReader(reader);}
    }
  });
}
/**
 * Wrap the upstream's `{statusCodeValue, body}` SSE envelope into plain
 * OpenAI SSE chunks the rest of the chatCore pipeline understands.
 *
 * Each upstream line looks like:
 *   data: {"statusCodeValue":200,"body":"{\"choices\":[{\"delta\":{...}}]}"}
 * The inner body is an OpenAI streaming chunk (or "[DONE]"). We unwrap it
 * and re-emit as `data: <inner>\n\n`. Only a raw OpenAI finish plus `[DONE]`
 * is allowed to produce a successful terminal.
 */
async function wrapQoderSSE(response, model, options = {}) {
  if (!response.ok || !response.body) return response;

  const peekTimeoutMs = options.timeoutMs ?? FETCH_CONNECT_TIMEOUT_MS;
  const reader = response.body.getReader();
  const peeked = await peekQoderBillingFrame(reader, peekTimeoutMs);
  if (peeked.billing) {
    await cancelAndReleaseReader(reader, "Qoder billing block");
    return Response.json({ error: { message: peeked.billing.body, code: 403 } }, { status: 403 });
  }
  const body = replayQoderBody(reader, peeked.chunks, peeked.done);

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let rawDoneSeen = false;
  let downstreamDoneEmitted = false;
  let failureEmitted = false;
  const rawTerminal = createUpstreamTerminalTracker({ format: FORMATS.OPENAI });

  const emitFailure = (controller) => {
    rawTerminal.fail();
    if (failureEmitted) return;
    failureEmitted = true;
    controller.enqueue(encoder.encode(
      `data: ${JSON.stringify({ error: { message: "Qoder upstream stream failed", type: "stream_error" } })}\n\n`
    ));
  };

  const observeRawDone = (controller) => {
    rawTerminal.observe({ rawDone: true });
    if (rawTerminal.outcome !== "success") {
      emitFailure(controller);
      return;
    }
    rawDoneSeen = true;
  };

  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    if (rawDoneSeen) {
      emitFailure(controller);
      return;
    }

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      observeRawDone(controller);
      return;
    }

    let envelope;
    try {envelope = JSON.parse(data);} catch {emitFailure(controller);return;}
    const statusVal = isNumber(envelope.statusCodeValue) ? envelope.statusCodeValue : 200;
    const inner = isString(envelope.body) ? envelope.body : "";
    if (statusVal !== 200) {
      emitFailure(controller);
      return;
    }
    if (!inner) return;
    if (inner === "[DONE]") {
      observeRawDone(controller);
      return;
    }
    const sanitized = inner.replace(/\r?\n/g, "");
    let parsed;
    try {parsed = JSON.parse(sanitized);}
    catch {emitFailure(controller);return;}
    rawTerminal.observe({ chunk: parsed });
    if (rawTerminal.outcome === "failure") {
      emitFailure(controller);
      return;
    }
    controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line, controller);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        processLine(buffer, controller);
        buffer = "";
      }
      if (!failureEmitted && rawDoneSeen && rawTerminal.outcome === "success") {
        controller.enqueue(encoder.encode(SSE_DONE));
        downstreamDoneEmitted = true;
      }
      if (!downstreamDoneEmitted) emitFailure(controller);
    }
  });

  const transformed = body.pipeThrough(transform);
  const transformedReader = transformed.getReader();
  const output = new ReadableStream({
    async pull(controller) {
      const { done, value } = await transformedReader.read();
      if (done) controller.close();else
      controller.enqueue(value);
    },
    async cancel(reason) {
      try {await transformedReader.cancel(reason);} finally
      {await cancelAndReleaseReader(reader, reason);}
    }
  });
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache"
    }
  });
}

// ── PAT (Personal Access Token) → job-token exchange ───────────────────────
// PATs (pt-...) cannot sign COSY requests directly. Exchange them for a
// short-lived job token (jt-...) via /api/v1/jobToken/exchange (plain JSON,
// not COSY-signed), then resolve the userId from userinfo. Mirrors the
// official qodercli flow. Cached per-PAT until near-expiry.
const PAT_PREFIX = "pt-";
const PAT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const patJobCache = new Map();

export function isQoderPat(token) {
  return isString(token) && token.startsWith(PAT_PREFIX);
}

async function exchangeJobToken(pat, proxyOptions = null, signal = null) {
  const res = await proxyAwareFetch(
    QODER_JOB_TOKEN_EXCHANGE_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "qodercli/1.0.0",
        "Cosy-Version": QODER_IDE_VERSION,
        "Cosy-ClientType": QODER_CLIENT_TYPE
      },
      body: JSON.stringify({ personal_token: pat }),
      signal
    },
    proxyOptions
  );
  if (!res.ok) {
    throw new Error(`qoder PAT exchange failed with HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error("qoder PAT exchange returned no job token");

  let expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (isNumber(data.expires_in) && data.expires_in > 0) {
    expiresAt = Date.now() + data.expires_in * 1000;
  }
  return { jobToken: data.token, jobRefreshToken: data.refresh_token || "", expiresAt };
}

async function fetchUserIdForJobToken(jobToken, proxyOptions = null, signal = null) {
  try {
    const res = await proxyAwareFetch(
      QODER_USERINFO_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jobToken}`,
          Accept: "application/json",
          "User-Agent": "qodercli/1.0.0"
        },
        signal
      },
      proxyOptions
    );
    if (!res.ok) return "";
    const info = await res.json().catch(() => ({}));
    return info.id || info.userId || info.user_id || "";
  } catch {
    return "";
  }
}

/**
 * Exchange a PAT for a job token + userId, caching until near-expiry so repeat
 * chat requests don't re-exchange. Returns { accessToken, userId }.
 */
async function resolvePatCredential(pat, proxyOptions = null, signal = null) {
  const cached = patJobCache.get(pat);
  if (cached && cached.expiresAt - Date.now() > PAT_REFRESH_BUFFER_MS) {
    return cached;
  }
  const { jobToken, expiresAt } = await exchangeJobToken(pat, proxyOptions, signal);
  const userId = await fetchUserIdForJobToken(jobToken, proxyOptions, signal);
  if (!userId) throw new Error("qoder PAT exchange could not resolve user identity");
  const entry = { accessToken: jobToken, userId, expiresAt };
  patJobCache.set(pat, entry);
  return entry;
}

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  buildUrl() {
    return QODER_CHAT_URL_ENCODED;
  }

  // Override execute entirely — Qoder needs:
  //   - body built from translated chat completion payload
  //   - body encoded with QoderEncodeBody before signing
  //   - COSY headers built from the *encoded* body bytes
  //   - response stream re-wrapped from {statusCodeValue, body} to OpenAI SSE
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null }) {
    // Clamp OpenAI-shape token fields before the qoder payload derives maxTokens.
    body = this.clampCustomMaxOutput({ ...body }, requestContext);
    const url = this.buildUrl();

    // PAT (pt-...) → exchange for short-lived job token + resolve userId so
    // downstream COSY signing + catalog fetch work. Device tokens (dt-...) and
    // job tokens (jt-...) skip this and are used directly.
    const rawToken = credentials?.apiKey || credentials?.accessToken;
    if (isQoderPat(rawToken)) {
      try {
        const resolved = await resolvePatCredential(rawToken, proxyOptions, signal);
        credentials = {
          ...credentials,
          accessToken: resolved.accessToken,
          apiKey: undefined,
          providerSpecificData: {
            authMethod: "pat",
            ...(credentials?.providerSpecificData || {}),
            userId: resolved.userId || credentials?.providerSpecificData?.userId || "",
            machineId: credentials?.providerSpecificData?.machineId || ""
          }
        };
      } catch (err) {
        const message = sanitizeErrorMessage(err?.message || "qoder PAT exchange failed");
        log?.error?.("QODER", message);
        const fakeResp = new Response(
          JSON.stringify({ error: { message } }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
        return { response: fakeResp, url, headers: {}, transformedBody: body };
      }
    }

    const psd = credentials?.providerSpecificData || {};
    if (!psd.userId) {
      // No user id → no way to sign. Surface a 401 so the dashboard nudges
      // the user back to OAuth.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing userId; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }
    if (!credentials?.accessToken) {
      // Same shape as the userId guard — clean 401 so chatCore reports
      // "reconnect" rather than bubbling cosy.js's synchronous throw as 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing accessToken; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    let qoderKey;
    let payload;
    try {
      ({ qoderKey, payload } = await buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal }));
    } catch (err) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: err.message } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
    const encodedBodyStr = qoderEncodeBody(plainBody);
    const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

    let cosyHeaders;
    try {
      cosyHeaders = buildCosyHeaders(
        encodedBodyBuf,
        url,
        {
          userId: psd.userId,
          authToken: credentials.accessToken,
          name: credentials.displayName || "",
          email: credentials.email || "",
          machineId: psd.machineId || ""
        }
      );
    } catch (err) {
      // cosy.js throws synchronously on missing userId/authToken — surface
      // as 401 so chatCore prompts re-auth instead of returning a 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const modelSource = payload.model_config && payload.model_config.source || "system";
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": qoderKey,
      "X-Model-Source": modelSource,
      // gzip triggers signature validation on Qoder's CDN; force identity.
      "Accept-Encoding": "identity",
      ...cosyHeaders
    };

    // Abort if upstream doesn't return response headers within connect timeout.
    const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
    const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

    let response;
    try {
      response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(
        url,
        { method: "POST", headers, body: encodedBodyBuf, signal: mergedSignal },
        proxyOptions
      ));
    } finally {
      clearTimeout(connectTimer);
    }

    if (!response.ok) {
      // Pass error response through unchanged so chatCore can capture it.
      return { response, url, headers, transformedBody: payload };
    }
    const wrapped = await wrapQoderSSE(response, `qoder/${qoderKey}`, { timeoutMs });
    return {
      response: wrapped,
      url,
      headers,
      transformedBody: payload,
      attemptStartedAt: getCurrentProviderAttemptTimestamp(),
      terminalProvenance: "validated"
    };
  }

  // Qoder device tokens don't refresh through OAuth — the upstream returns
  // 403 for our flow. Surfacing failure via 401-on-chat is enough; the
  // dashboard tells users to re-login when their token expires (~30 days).
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default QoderExecutor;

// Internals exposed for unit tests. Not part of the public API — callers
// should import QoderExecutor and use its public methods.
export const __test__ = {
  normalizeMessages,
  wrapQoderSSE,
  isBillingBlock,
  buildQoderRequestBody,
  isQoderPat,
  resolvePatCredential
};