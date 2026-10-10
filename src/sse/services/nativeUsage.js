import streamJson from "stream-json";
import { getApiKeyByKey, getApiKeyUsageLimitStatus } from "@/lib/localDb";
import { API_KEY_LIMIT_FIELDS } from "@/lib/db/helpers/apiKeyPolicy.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsage } from "./apiKeyPolicy.js";
import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";
import { mediaAccounting } from "../../../open-sse/handlers/mediaAccounting.js";

const METADATA_FIELDS = new Set(["id", "task_id", "request_id", "file_id", "voice_id", "status", "type", "event", "object"]);
const TOKEN_FIELDS = new Set([
  "input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens", "total_token_count",
  "promptTokenCount", "responseTokenCount", "candidatesTokenCount", "totalTokenCount", "thoughtsTokenCount",
  "cachedContentTokenCount", "toolUsePromptTokenCount",
  "cache_read_input_tokens", "cache_creation_input_tokens", "cached_tokens", "reasoning_tokens", "audio_tokens", "text_tokens",
  "cost", "cost_usd", "cost_in_usd", "cost_in_usd_ticks",
]);
const DETAIL_FIELDS = new Set(["input_tokens_details", "prompt_tokens_details", "output_tokens_details", "completion_tokens_details"]);
const WRAPPERS = new Set(["response", "message", "data"]);
const METADATA_WRAPPERS = new Set([...WRAPPERS, "file"]);
const GEMINI_PROVIDERS = new Set(["gemini", "google_ai_studio", "antigravity", "agy"]);
const MAX_METADATA_STRING = 4096;

export function nativeUsageFromValue(value) {
  const usage = value?.usageMetadata || value?.usage || value?.meta?.tokens || value?.response?.usage || value?.message?.usage || value?.data?.usage;
  if (!usage || !isObject(usage) || Array.isArray(usage)) return null;
  // Preserve reported values for ledger validation; totals never imply a split.
  const input = usage.promptTokenCount ?? usage.input_tokens ?? usage.prompt_tokens;
  let output = usage.responseTokenCount ?? usage.output_tokens ?? usage.completion_tokens;
  // Gemini candidates exclude thoughts; the ledger stores reasoning within output.
  if (output === undefined && usage.candidatesTokenCount !== undefined) {
    const candidates = usage.candidatesTokenCount;
    const thoughts = usage.thoughtsTokenCount ?? 0;
    output = isNumber(candidates) && isNumber(thoughts) && candidates >= 0 && thoughts >= 0
      ? candidates + thoughts : !isNumber(candidates) || candidates < 0 ? candidates : thoughts;
  }
  const total = usage.totalTokenCount ?? usage.total_tokens ?? usage.total_token_count;
  const normalized = { ...usage };
  if (input !== undefined) normalized.input_tokens = input;
  if (output !== undefined) normalized.output_tokens = output;
  if (total !== undefined) normalized.total_tokens = total;
  if (usage.cachedContentTokenCount !== undefined) normalized.cached_tokens = usage.cachedContentTokenCount;
  if (usage.prompt_tokens_details && !usage.input_tokens_details) normalized.input_tokens_details = usage.prompt_tokens_details;
  if (usage.completion_tokens_details && !usage.output_tokens_details) normalized.output_tokens_details = usage.completion_tokens_details;
  return normalized;
}

function isNativeError(value) {
  const type = String(value?.type || value?.event || "").toLowerCase();
  const status = String(value?.response?.status ?? value?.status ?? value?.data?.status ?? "").toLowerCase();
  return Boolean(value?.error || value?.response?.error || value?.data?.error) ||
    Boolean(value?.promptFeedback?.blockReason) ||
    (Array.isArray(value?.candidates) && value.candidates.some((candidate) => candidate?.finishReason != null && candidate.finishReason !== "STOP")) ||
    (value?.base_resp?.status_code != null && value.base_resp.status_code !== 0) ||
    ["error", "response.failed", "response.incomplete", "response.cancelled", "response.canceled"].includes(type) ||
    ["failed", "error", "incomplete", "cancelled", "canceled", "aborted", "fail"].includes(status);
}

export function isNativeTerminalUsageEvent(event, details = {}) {
  if (isNativeError(event)) return false;
  if (GEMINI_PROVIDERS.has(details.provider)) {
    // Usage-only trailers update the receipt but never establish successful completion.
    return Array.isArray(event?.candidates) && event.candidates.some((candidate) => candidate?.finishReason === "STOP");
  }
  const type = String(event?.type || event?.event || "").toLowerCase();
  const status = String(event?.response?.status ?? event?.status ?? "").toLowerCase();
  // Item/content completion is not response completion. Realtime response.done
  // also covers failed responses, so its nested status must confirm success.
  if (["message_stop", "response.completed", "conversation.item.input_audio_transcription.completed"].includes(type)) return true;
  if (type === "response.done") return status === "completed";
  if (type) return false;
  if (["completed", "complete", "done", "finished"].includes(status)) return true;
  if (["minimax", "minimax-cn"].includes(details.provider)) {
    if (/^\/v[12]\/query\/(?:video_generation|t2a_async_query_v2)(?:\/|$)/.test(details.endpoint || "")) return status === "success";
    if (["/v1/t2a_v2", "/v1/music_generation"].includes(details.endpoint)) return (event?.data?.status ?? event?.status) === 2;
  }
  return false;
}

export async function nativeUsageAdmission(apiKey) {
  if (!apiKey) return null;
  const status = await getApiKeyUsageLimitStatus(apiKey);
  return status.exceeded ? new Response("API key daily token limit reached", { status: 429 }) : null;
}

export async function nativeDirectSessionAllowed(apiKey) {
  if (!apiKey) return true;
  const key = await getApiKeyByKey(apiKey);
  if (!key) return true;
  let policy = key.policy || {};
  try { if (isString(policy)) policy = JSON.parse(policy || "{}"); } catch { return false; }
  return key.dailyLimitTokens == null && policy.maxTokens == null && policy.maxCostUsd == null &&
    API_KEY_LIMIT_FIELDS.every((field) => !Number.isFinite(Number(policy[field])) || Number(policy[field]) <= 0);
}

/**
 * Commit a native event through the same ledger as chat and media. Normalized
 * accounting fields (tokens, cost, costStatus, costSource, modality, nativeUnits,
 * meta and timestamp) pass through unchanged; provider usage supplies tokens
 * when present. Missing event identity or usage throws rather than losing spend.
 * Native callers supply explicit cost provenance and native units. The observer
 * preserves final provider USD receipts through mediaAccounting without deriving
 * native units from output payloads. Incomplete accounting events throw.
 * billingEpoch is the dispatch/creation stamp, including explicit null before
 * cutover. Never refresh it here: the ledger rejects stale in-flight completions.
 */
export async function recordNativeUsage({ apiKey, provider, model, connectionId, endpoint, value, usageEventId, billingEpoch, fallbackUsage = null, ...accounting }) {
  const tokens = nativeUsageFromValue(value) || accounting.tokens || fallbackUsage;
  if (!usageEventId || !tokens) throw new TypeError("Native usage requires usageEventId and a token object (empty for non-token usage)");
  await recordApiKeyUsage(apiKey, { ...accounting, provider, model, connectionId, endpoint, tokens, usageEventId, billingEpoch });
  if (!apiKey) return true;
  if (await nativeUsageAdmission(apiKey)) return false;
  return !(await enforceApiKeyModelPolicy(new Request("http://127.0.0.1/native-usage"), `${provider}/${model}`, apiKey, { limits: false }));
}

// Select only declared envelope metadata and usage. Output/tool objects must not
// replace the response id or inject usage, and large strings are never retained.
function createJsonCollector() {
  const parser = streamJson.parser({ packKeys: true, packStrings: false, streamStrings: true, packNumbers: true, streamNumbers: false });
  const frames = [];
  const result = {};
  let capture = null;
  let error = null;
  parser.on("error", (cause) => { error = cause; });

  const selectedField = (key) => {
    if (frames.length === 3 && frames[0].kind === "object" && frames[1].kind === "array" &&
        frames[1].segment === "candidates" && frames[2].kind === "object" && key === "finishReason") return { finishReason: true };
    if (frames.length === 2 && frames[1].segment === "promptFeedback" && key === "blockReason") return { blockReason: true };
    if (!key || frames.length === 0 || frames.length > 4 || frames.some((frame) => frame.kind !== "object")) return null;
    const rootMetadata = frames.length === 1 || frames.length === 2 && METADATA_WRAPPERS.has(frames[1].segment);
    if (rootMetadata && key === "error") return { failure: true };
    if (frames.length === 2 && frames[1].segment === "base_resp" && key === "status_code") return { statusCode: true };
    if (rootMetadata && METADATA_FIELDS.has(key)) return { metadata: key, root: frames.length === 1 };
    const usageIndex = frames[1]?.segment === "meta" && frames[2]?.segment === "tokens" ? 2 :
      ["usage", "usageMetadata"].includes(frames[1]?.segment) ? 1 :
      WRAPPERS.has(frames[1]?.segment) && frames[2]?.segment === "usage" ? 2 : -1;
    if (usageIndex < 0 || !TOKEN_FIELDS.has(key)) return null;
    if (frames.length === usageIndex + 1) return { metric: key };
    if (frames.length === usageIndex + 2 && DETAIL_FIELDS.has(frames.at(-1).segment)) return { metric: key, detail: frames.at(-1).segment };
    return null;
  };
  const apply = (selection, value) => {
    if (!selection) return;
    if (selection.failure) { if (value != null && value !== false) result.error = true; return; }
    if (selection.statusCode) { result.base_resp = { status_code: value }; return; }
    if (selection.finishReason) {
      // Keep only completion metadata, never candidate content or an unbounded array.
      if (!result.candidates || result.candidates[0].finishReason === "STOP") result.candidates = [{ finishReason: value }];
      return;
    }
    if (selection.blockReason) { result.promptFeedback = { blockReason: value }; return; }
    if (selection.metadata) {
      if (selection.root || result[selection.metadata] === undefined) result[selection.metadata] = value;
      return;
    }
    // Invalid metrics must reach the ledger, not disappear into fallback usage.
    result.usage ||= {};
    if (selection.detail) (result.usage[selection.detail] ||= {})[selection.metric] = value;
    else result.usage[selection.metric] = value;
  };
  parser.on("data", (token) => {
    const parent = frames.at(-1);
    if (token.name === "keyValue") { if (parent) parent.key = token.value; }
    else if (token.name === "startObject" || token.name === "startArray") {
      const selection = selectedField(parent?.key);
      if (selection?.metric || selection?.failure) apply(selection, token.name === "startObject" ? {} : []);
      const segment = parent?.kind === "object" ? parent.key : null;
      if (parent) parent.key = null;
      frames.push({ kind: token.name === "startObject" ? "object" : "array", segment, key: null });
    } else if (token.name === "endObject" || token.name === "endArray") frames.pop();
    else if (token.name === "startString") capture = { selection: selectedField(parent?.key), text: "" };
    else if (token.name === "stringChunk" && capture?.selection) {
      if (capture.text.length + token.value.length > MAX_METADATA_STRING) throw new Error("Native response metadata exceeds its limit");
      capture.text += token.value;
    } else if (token.name === "endString") {
      apply(capture?.selection, capture?.text);
      capture = null;
      if (parent) parent.key = null;
    } else if (["numberValue", "trueValue", "falseValue", "nullValue"].includes(token.name)) {
      const selection = selectedField(parent?.key);
      const resourceId = selection?.metadata === "id" || selection?.metadata?.endsWith("_id");
      apply(selection, token.name === "numberValue" && !resourceId ? Number(token.value) : token.value);
      if (parent) parent.key = null;
    }
  });
  return {
    async write(chunk) {
      if (error) throw error;
      await new Promise((resolve, reject) => parser.write(chunk, (cause) => cause ? reject(cause) : resolve()));
      if (error) throw error;
    },
    async finish() {
      if (error) throw error;
      await new Promise((resolve, reject) => { parser.once("finish", resolve); parser.once("error", reject); parser.end(); });
      if (error) throw error;
      return result;
    },
  };
}

function mergeEnvelope(target, value) {
  for (const field of METADATA_FIELDS) if (value[field] !== undefined) target[field] = value[field];
  if (value.error) target.error = true;
  if (value.base_resp) target.base_resp = value.base_resp;
  if (value.candidates) target.candidates = value.candidates;
  if (value.promptFeedback) target.promptFeedback = value.promptFeedback;
  if (!value.usage) return;
  target.usage ||= {};
  for (const [field, metric] of Object.entries(value.usage)) {
    if (DETAIL_FIELDS.has(field)) target.usage[field] = { ...target.usage[field], ...metric };
    else target.usage[field] = metric;
  }
}

// Feed data lines directly into the JSON tokenizer. Neither a long SSE line nor
// an image-bearing response.completed event is assembled into an in-memory string.
function createSseCollector(onValue) {
  const result = {};
  let event = null;
  let ignoreEvent = false;
  let hasData = false;
  let marker = "";
  let eventName = "";
  let prefix = "";
  let dataLine = false;
  let skipSpace = false;
  let lineHasCharacters = false;
  const feedData = async (text) => {
    if (!text) return;
    if (ignoreEvent) { marker = (marker + text).slice(0, 16); return; }
    if (!event) {
      const trimmed = text.trimStart();
      if (!trimmed) return;
      if (!trimmed.startsWith("{")) { ignoreEvent = true; marker = trimmed.slice(0, 16); return; }
      event = createJsonCollector();
    }
    await event.write(text);
  };
  const finishEvent = async () => {
    if (event) {
      const value = await event.finish();
      if (!value.type && eventName) value.event = eventName.replace(/^:/, "").trim();
      mergeEnvelope(result, value);
      await onValue?.(value, result);
    }
    else if (marker.trim() === "[DONE]") await onValue?.({ type: "[DONE]" }, result);
    event = null; ignoreEvent = false; hasData = false; marker = ""; eventName = "";
  };
  const segment = async (text) => {
    if (!text) return;
    lineHasCharacters = true;
    let offset = 0;
    if (prefix === "event") { eventName = (eventName + text).slice(0, 128); return; }
    if (!dataLine && prefix.length < 5) {
      const amount = Math.min(5 - prefix.length, text.length);
      prefix += text.slice(0, amount); offset = amount;
      if (prefix.length === 5 && prefix === "data:") {
        dataLine = true; skipSpace = true;
        if (hasData && event) await event.write("\n");
        hasData = true;
      }
    }
    if (prefix === "event") { eventName = text.slice(offset, offset + 128); return; }
    if (!dataLine) return;
    if (skipSpace && offset < text.length) { if (text[offset] === " ") offset++; skipSpace = false; }
    await feedData(text.slice(offset));
  };
  return {
    async write(text) {
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf("\n", offset);
        const end = newline < 0 ? text.length : newline;
        const part = text.slice(offset, end);
        await segment(part.endsWith("\r") ? part.slice(0, -1) : part);
        if (newline < 0) break;
        if (!lineHasCharacters) await finishEvent();
        prefix = ""; dataLine = false; skipSpace = false; lineHasCharacters = false;
        offset = newline + 1;
      }
    },
    // EOF does not dispatch an unterminated SSE event.
    async finish() {
      if (hasData || eventName) await onValue?.({ type: "error" }, result);
      return result;
    },
  };
}

/**
 * Observe one logical billable event. Callers supply a stable usageEventId,
 * reused for retries and changed for each distinct operation, even on the same
 * resource. The explicit ID passes to the ledger unchanged.
 * Without it, billableOperationId must identify a documented provider billing
 * operation, not a voice/file/resource. Its scope is provider, connectionId and
 * endpoint (use the same canonical endpoint for creation and completion polls).
 * Response IDs and resourceId never establish billing identity. Missing identity
 * fails closed when usage is committed; streams require a successful protocol
 * terminal followed by clean EOF, never EOF alone or an item-level done event.
 * Error envelopes and aborted streams are not success.
 * Gemini requires STOP plus clean EOF; safety/error finishes never commit. Final
 * usageMetadata trailers replace earlier components, including cache and thoughts.
 * onValue observes creation metadata before terminal accounting. onEnd validates
 * ownership at clean, non-error EOF, including queued responses; onComplete
 * remains restricted to successful terminal accounting.
 */
export function observeNativeResponse(response, details) {
  if (!response.body) return response;
  const contentType = response.headers.get("content-type") || "";
  const sse = /text\/event-stream/i.test(contentType);
  const json = /(?:application\/json|\+json)/i.test(contentType);
  const committedEvents = new Set();
  let failed = !response.ok;
  let completed = false;
  let terminalSeen = false;
  const commit = async (value) => {
    if (failed) return;
    const usageEventId = details.usageEventId || (
      details.billableOperationId && details.provider && details.connectionId && details.endpoint
        ? JSON.stringify([details.provider, details.connectionId, details.endpoint, details.billableOperationId, "terminal"])
        : null
    );
    if (committedEvents.has(usageEventId)) return;
    if (!(nativeUsageFromValue(value) || details.tokens || details.fallbackUsage)) return;
    // The bounded collector flattens provider usage wrappers; restore the helper's
    // provider-specific entry point without retaining output payloads.
    const receiptValue = details.provider === "cohere" ? { meta: { tokens: value.usage } } :
      ["gemini", "google_ai_studio", "antigravity", "agy"].includes(details.provider) ? { usageMetadata: value.usage } : value;
    const receipt = mediaAccounting(receiptValue, details.provider, details.modality);
    const accounting = { ...details, meta: { ...details.meta, ...receipt.meta } };
    if (receipt.costStatus === "known") {
      accounting.cost = receipt.cost;
      accounting.costStatus = receipt.costStatus;
      accounting.costSource = receipt.costSource;
    }
    await recordNativeUsage({ ...accounting, value, usageEventId });
    committedEvents.add(usageEventId);
  };
  const complete = async (value) => {
    if (failed || completed) return;
    await details.onComplete?.();
    await commit(value);
    completed = true;
  };
  const collector = sse ? createSseCollector(async (value, accumulated) => {
    failed ||= isNativeError(value);
    if (failed || completed) return;
    await details.onValue?.(value);
    if (isNativeTerminalUsageEvent(value, details) ||
        !GEMINI_PROVIDERS.has(details.provider) && value.type === "[DONE]" && accumulated.object === "chat.completion.chunk") {
      terminalSeen = true;
    }
  }) : json ? createJsonCollector() : null;
  const decoder = sse ? new TextDecoder() : null;
  const stream = new TransformStream({
    async transform(chunk, controller) {
      if (sse) await collector.write(decoder.decode(chunk, { stream: true }));
      else if (json) await collector.write(chunk);
      controller.enqueue(chunk);
    },
    async flush() {
      if (sse) await collector.write(decoder.decode());
      const value = collector ? await collector.finish() : {};
      failed ||= isNativeError(value);
      if (failed) return;
      if (!sse) await details.onValue?.(value);
      await details.onEnd?.();
      // A terminal followed by transport failure or an error event is not success.
      if (sse) {
        if (terminalSeen) await complete(value);
        return;
      }
      const terminal = isNativeTerminalUsageEvent(value, details);
      if (terminal || !GEMINI_PROVIDERS.has(details.provider) && !details.terminalOnly && value.status == null && (!value.type || value.type === "message") && !value.event) await complete(value);
    },
  });
  return new Response(response.body.pipeThrough(stream), { status: response.status, statusText: response.statusText, headers: response.headers });
}
