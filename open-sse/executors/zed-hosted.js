// Zed-hosted executor (staged; not registered in executors/index.js).
//
// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/zed-hosted.ts and open-sse/executors/zedClientVersion.ts (MIT),
// originally decolua/9router PR #2328.
//
// POST cloud.zed.dev/completions takes a thread envelope whose `provider_request` is
// shaped for whichever vendor Zed fronts for the model (Anthropic Messages, Gemini,
// OpenAI Responses or xAI chat). The reply is a line-delimited stream of
// `{"event": <vendor chunk>}` / `{"status": ...}` frames, which are converted back
// to OpenAI chat chunks with the gateway's own translators. The stream is always
// requested upstream; the registry entry sets forceStream so chatCore turns it into
// JSON for clients that did not ask to stream.
//
// Dispatch is off unless the connection sets providerSpecificData.enableSessionDispatch
// to the boolean true. A refused request makes no network call.
import { BaseExecutor } from "./base.js";
import { FORMATS } from "../translator/formats.js";
import { initState } from "../translator/index.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import { openaiToGeminiRequest } from "../translator/request/openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { claudeToOpenAIResponse } from "../translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../translator/response/gemini-to-openai.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { buildErrorBody } from "../utils/error.js";
import { createExecutorSender, requestAbortError, withBillableDispatch } from "./sendRequest.js";
import { settleProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { credentialFetch } from "../utils/credentialFetch.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";
import {
  ZED_HEADERS,
  ZED_HOSTED_CONFIG,
  ZED_OPT_IN_KEY,
  ZedHostedError,
  resolveZedModels,
  zedDispatchDisabledError,
  zedHostedOptIn,
  zedLlmFetch,
} from "../shared/zedHostedAuth.js";

export const ZED_HOSTED_URL = "https://cloud.zed.dev/completions";
// Advertised editor version for x-zed-version. Pinned from upstream; a connection can
// override it with providerSpecificData.appVersion.
export const ZED_CLIENT_VERSION = "0.200.0";

// Wire values for `provider`. cloud.zed.dev matches these exactly: an unknown value
// fails the request with a 500 before the model is looked at.
const ZED_PROVIDER = Object.freeze({ anthropic: "anthropic", openai: "open_ai", google: "google", xai: "x_ai" });

export function normalizeZedProvider(value, model) {
  const raw = String(value || "").toLowerCase();
  if (raw === "anthropic") return ZED_PROVIDER.anthropic;
  if (raw === "openai" || raw === "open_ai") return ZED_PROVIDER.openai;
  if (raw === "google" || raw === "gemini") return ZED_PROVIDER.google;
  if (raw === "xai" || raw === "x_ai" || raw === "x-ai") return ZED_PROVIDER.xai;
  const m = String(model || "").toLowerCase();
  if (m.includes("claude")) return ZED_PROVIDER.anthropic;
  if (m.includes("gemini")) return ZED_PROVIDER.google;
  if (m.includes("grok") || m.includes("xai")) return ZED_PROVIDER.xai;
  return ZED_PROVIDER.openai;
}

const record = (value) => (value && isObject(value) ? value : null);

// Zed's Google proxy enums are narrower than Google's: safety threshold has no "OFF",
// FunctionCallingMode is lowercase auto/any/none, thinkingLevel is uppercase-only.
const FUNCTION_CALLING_MODES = { VALIDATED: "auto", AUTO: "auto", ANY: "any", NONE: "none" };

export function adaptGeminiRequestForZed(request) {
  const req = record(request);
  if (!req) return request;
  if (Array.isArray(req.safetySettings)) {
    for (const setting of req.safetySettings) if (record(setting)?.threshold === "OFF") setting.threshold = "BLOCK_NONE";
  }
  const calling = record(record(req.toolConfig)?.functionCallingConfig);
  const mapped = calling ? FUNCTION_CALLING_MODES[String(calling.mode || "").toUpperCase()] : undefined;
  if (calling && mapped) calling.mode = mapped;
  const thinking = record(record(req.generationConfig)?.thinkingConfig);
  if (isString(thinking?.thinkingLevel)) thinking.thinkingLevel = thinking.thinkingLevel.toUpperCase();
  return request;
}

// Zed's OpenAI proxy has no "developer" role.
export function adaptResponsesRequestForZed(request) {
  const input = record(request)?.input;
  if (!Array.isArray(input)) return request;
  for (const item of input) if (record(item)?.role === "developer") item.role = "system";
  return request;
}

function buildProviderRequest(provider, model, body, stream, credentials) {
  if (provider === ZED_PROVIDER.anthropic) return openaiToClaudeRequest(model, body, true);
  if (provider === ZED_PROVIDER.google) return adaptGeminiRequestForZed(openaiToGeminiRequest(model, body, true, credentials));
  if (provider === ZED_PROVIDER.openai) return adaptResponsesRequestForZed(openaiToOpenAIResponsesRequest(model, body, true, credentials));
  return { ...body, model, stream: stream !== false };
}

function initProviderState(provider, model, toolNameMap) {
  if (provider === ZED_PROVIDER.openai) return initState(FORMATS.OPENAI_RESPONSES);
  let state;
  if (provider === ZED_PROVIDER.anthropic) state = initState(FORMATS.CLAUDE);
  else if (provider === ZED_PROVIDER.google) state = initState(FORMATS.GEMINI);
  else { state = initState(FORMATS.OPENAI); state.model = model; }
  state.toolNameMap = {
    get: (name) => toolNameMap?.get?.(name) || (isString(name) && name.startsWith("proxy_") ? name.slice(6) : name),
  };
  return state;
}

function convertProviderEvent(provider, event, state) {
  if (provider === ZED_PROVIDER.anthropic) return claudeToOpenAIResponse(event, state);
  if (provider === ZED_PROVIDER.google) return geminiToOpenAIResponse(event, state);
  if (provider === ZED_PROVIDER.openai) return openaiResponsesToOpenAIResponse(event, state);
  return event;
}

const MAX_FAILURE_MESSAGE_LENGTH = 512;
const MAX_PENDING_OUTPUT_LENGTH = 64 * 1024;
const STREAM_FAILURE_PUBLIC_MESSAGE = "Zed upstream stream failed";

function boundedText(value) {
  if (!isString(value) && !isNumber(value)) return null;
  const text = String(value).trim();
  return text ? text.slice(0, MAX_FAILURE_MESSAGE_LENGTH) : null;
}

function failureMessage(failed) {
  const nested = record(failed.error) && !Array.isArray(failed.error) ? failed.error : null;
  for (const candidate of [failed.message, nested?.message, nested ? undefined : failed.error, failed.code, nested?.code]) {
    const text = boundedText(candidate);
    if (text) return text;
  }
  return "request failed";
}

function sse(chunk) {
  if (!chunk) return "";
  return (Array.isArray(chunk) ? chunk : [chunk]).filter(Boolean).map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
}

// Role/bootstrap-only frames carry no answer. Holding them back until the first real
// delta keeps a later `failed` status from discarding content a client already read.
function hasUsefulContent(serialized) {
  for (const line of serialized.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let parsed;
    try { parsed = JSON.parse(line.slice(5)); } catch { continue; }
    for (const choice of parsed?.choices || []) {
      const delta = choice?.delta || {};
      if (delta.content || delta.reasoning_content || delta.reasoning || delta.tool_calls?.length || choice?.finish_reason) return true;
    }
    if (parsed?.error) return true;
  }
  return false;
}

function unwrapLine(line) {
  let text = line.replace(/\r$/, "").trim();
  if (!text) return null;
  if (text.startsWith("data:")) text = text.slice(5).trimStart();
  if (text === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(text);
    if (parsed && Object.hasOwn(parsed, "event")) return { event: parsed.event };
    if (parsed && Object.hasOwn(parsed, "status")) return { status: parsed.status };
    return { event: parsed };
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  if (!status) return null;
  if (isString(status)) return { type: status };
  if (isObject(status)) {
    const key = Object.keys(status)[0];
    if (key && isObject(status[key])) return { type: key, ...status[key] };
    return status;
  }
  return null;
}

export function wrapZedCompletionStream(response, provider, model, options = {}) {
  if (!response.ok || !response.body) return response;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initProviderState(provider, model, options.toolNameMap);
  let buffer = "";
  let done = false;
  let forwarded = false;
  let pending = "";
  let pendingFailure = null;

  const forward = (controller, chunk) => {
    const serialized = sse(chunk);
    if (!serialized) return;
    if (forwarded) { controller.enqueue(encoder.encode(serialized)); return; }
    const combined = pending + serialized;
    if (!hasUsefulContent(combined)) {
      pending = combined.length <= MAX_PENDING_OUTPUT_LENGTH ? combined : serialized.length <= MAX_PENDING_OUTPUT_LENGTH ? serialized : "";
      return;
    }
    controller.enqueue(encoder.encode(combined));
    pending = "";
    forwarded = true;
  };

  const finish = (controller) => {
    if (done) return;
    controller.enqueue(encoder.encode(`${pending}${sse(convertProviderEvent(provider, null, state))}data: [DONE]\n\n`));
    pending = "";
    done = true;
  };

  const processLine = (line, controller) => {
    if (done) return;
    const payload = unwrapLine(line);
    if (!payload) return;
    if (payload.done) return finish(controller);
    if (payload.status) {
      const status = normalizeStatus(payload.status);
      if (status?.type === "failed" || status?.failed) {
        const failed = record(status.failed) && !Array.isArray(status.failed) ? status.failed : status;
        if (forwarded) {
          pendingFailure = Object.assign(new Error(STREAM_FAILURE_PUBLIC_MESSAGE), { statusCode: 502 });
        } else {
          pending = "";
          controller.enqueue(encoder.encode(sse(buildErrorBody(502, `Zed stream failed: ${failureMessage(failed)}`, { type: "upstream_error", code: "ZED_STREAM_FAILED" }))));
        }
        done = true;
        controller.terminate();
      } else if (status?.type === "stream_ended") {
        finish(controller);
      }
      return;
    }
    forward(controller, convertProviderEvent(provider, payload.event, state));
  };

  const transformed = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processLine(line, controller);
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) { processLine(buffer, controller); buffer = ""; }
      finish(controller);
    },
  }));

  // controller.error() on the transform would discard already-enqueued output, and a
  // failed status can share a network chunk with the last delta. Drain first, then fail.
  const reader = transformed.getReader();
  let cancelled = false;
  const guarded = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (cancelled) return;
        if (!next.done) return controller.enqueue(next.value);
        if (pendingFailure) return controller.error(pendingFailure);
        controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel(reason) {
      if (cancelled) return;
      cancelled = true;
      void reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(guarded, { status: response.status, statusText: response.statusText, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

function failure(status, code, message, body, extraHeaders = {}) {
  return {
    response: new Response(JSON.stringify(buildErrorBody(status, message, { type: "upstream_error", code })), {
      status, headers: { "Content-Type": "application/json", ...extraHeaders },
    }),
    url: ZED_HOSTED_URL,
    headers: {},
    transformedBody: body,
  };
}

// Credential failures (bad or revoked sign-in, rejected LLM token) are 401 so the
// gateway marks the connection unusable; rate and quota limits stay 429.
function mapAuthError(error) {
  const status = error?.status;
  if (status === 401 || status === 403) return [401, "zed_hosted_signin_invalid", "Zed sign-in is invalid or expired. Sign in to Zed again."];
  if (status === 429) return [429, "zed_hosted_rate_limited", `Zed rate limit or quota reached: ${error.message}`];
  if (status >= 400 && status < 500) return [status, error.code || "zed_hosted_error", error.message];
  return [502, "zed_hosted_error", error?.message || "Zed request failed"];
}

export class ZedHostedExecutor extends BaseExecutor {
  constructor(deps = {}) {
    super("zed-hosted", { id: "zed-hosted", baseUrl: ZED_HOSTED_URL });
    this.config = { ...this.config, ...ZED_HOSTED_CONFIG };
    this.deps = deps;
  }

  async resolveModel(model, credentials, options) {
    const lookup = (forceRefresh) => resolveZedModels(credentials, { ...options, config: this.config, forceRefresh });
    try {
      let raw = (await lookup(false))?.rawById?.get(model) ?? null;
      if (!raw) raw = (await lookup(true))?.rawById?.get(model) ?? null;
      return normalizeZedProvider(raw?.provider, model);
    } catch (error) {
      // An expired or revoked sign-in must surface as such, not as a guessed vendor.
      if (error?.status === 401 || error?.status === 403 || error?.status === 429) throw error;
      return normalizeZedProvider(null, model);
    }
  }

  async execute(input) {
    if (input.signal?.aborted) throw requestAbortError(input.signal.reason);
    const sender = createExecutorSender(this, input, { observePatchedFetch: false });
    return withBillableDispatch(sender, (billed) => this.runChat(input, sender, billed));
  }

  async runChat({ model, body, stream, credentials, signal, proxyOptions = null }, sender, billed) {
    const requestBody = body ?? {};
    if (!zedHostedOptIn(credentials)) {
      const refused = zedDispatchDisabledError();
      return failure(refused.status, refused.code, refused.message, requestBody);
    }
    // Token and catalog requests are not charged; each completion send is quota-bearing.
    // An injected fetch replaces the network send under the same transport policy.
    let completion = null;
    const baseFetch = async (url, init) => {
      const quotaBearing = new URL(url).pathname.endsWith("/completions");
      // A completion resent with a fresh LLM token discards the rejected one.
      if (quotaBearing) await settleProviderAttemptDispatch(completion, { reason: "fallback" });
      const response = await sender.sendRequest(url, init, proxyOptions, {
        quotaBearing,
        transport: this.deps.fetch ? (options) => this.deps.fetch(url, options) : null,
      });
      if (quotaBearing) completion = billed(response);
      return response;
    };
    const options = { fetch: (url, init) => credentialFetch(baseFetch, url, init), signal };
    try {
      const provider = await this.resolveModel(model, credentials, options);
      const providerRequest = buildProviderRequest(provider, model, requestBody, stream, credentials);
      const payload = {
        thread_id: requestBody.thread_id || credentials?._clientSessionId,
        prompt_id: requestBody.prompt_id,
        provider,
        model,
        provider_request: providerRequest,
      };
      const response = await zedLlmFetch(credentials, "/completions", {
        ...options,
        config: this.config,
        fetchOptions: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson, text/event-stream, */*",
            "User-Agent": "DurinDoor/zed-hosted",
            "x-zed-version": String(credentials?.providerSpecificData?.appVersion || ZED_CLIENT_VERSION),
            [ZED_HEADERS.clientSupportsStatus]: "true",
            [ZED_HEADERS.clientSupportsStreamEnded]: "true",
          },
          body: JSON.stringify(payload),
        },
      });
      const toolNameMap = providerRequest?._toolNameMap instanceof Map ? providerRequest._toolNameMap : toolMapFor(requestBody);
      return {
        response: response.ok ? wrapZedCompletionStream(response, provider, model, { toolNameMap }) : response,
        url: ZED_HOSTED_URL,
        headers: { "Content-Type": "application/json", Authorization: "Bearer <zed-llm-token>" },
        transformedBody: payload,
      };
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (error?.statusCode === 400) return failure(400, "zed_hosted_bad_request", error.message, requestBody);
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      const [status, code, message] = mapAuthError(error);
      return failure(status, code, message, requestBody);
    }
  }

  parseError(response, bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || "{}"); } catch { parsed = null; }
    const code = parsed?.code || parsed?.error?.code || "";
    const message = parsed?.message || parsed?.error?.message || bodyText || response.statusText;
    if (code === "trial_blocked") {
      return { status: response.status, message: `Zed trial access is blocked upstream. The account can list hosted models, but Zed refuses completions until trial or billing access is enabled. Zed says: ${message}` };
    }
    // The gateway's own codes (zed_hosted_*) are already self-describing.
    if (code && !String(code).startsWith("zed_hosted_")) return { status: response.status, message: `Zed ${code}: ${message}` };
    return { status: response.status, message: message || `Zed upstream error: ${response.status}` };
  }

  // The long-lived Zed access token has no refresh grant; expired LLM tokens are
  // re-exchanged inside zedLlmFetch, so there is nothing for the gateway to rotate.
  async refreshCredentials() { return null; }
  needsRefresh() { return false; }
}

function toolMapFor(body) {
  if (!Array.isArray(body?.tools)) return null;
  const map = new Map();
  for (const tool of body.tools) {
    const name = tool?.function?.name ?? tool?.name;
    if (isString(name) && name) { map.set(`proxy_${name}`, name); map.set(name, name); }
  }
  return map;
}

export { ZED_OPT_IN_KEY, ZedHostedError };
export default ZedHostedExecutor;
