import streamJson from "stream-json";
import { getApiKeyByKey, getApiKeyUsageLimitStatus, saveRequestUsage } from "@/lib/localDb";
import { API_KEY_LIMIT_FIELDS } from "@/lib/db/helpers/apiKeyPolicy.js";
import { enforceApiKeyModelPolicy } from "./apiKeyPolicy.js";
import { isNumber, isObject, isString } from "../../shared/utils/typeChecks.js";

const METADATA_FIELDS = new Set(["id", "task_id", "request_id", "file_id", "voice_id", "status", "type", "event", "object"]);
const TOKEN_FIELDS = new Set([
  "input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens", "total_token_count",
  "cache_read_input_tokens", "cache_creation_input_tokens", "cached_tokens", "reasoning_tokens", "audio_tokens", "text_tokens",
]);
const DETAIL_FIELDS = new Set(["input_tokens_details", "prompt_tokens_details", "output_tokens_details", "completion_tokens_details"]);
const WRAPPERS = new Set(["response", "message", "data"]);
const METADATA_WRAPPERS = new Set([...WRAPPERS, "file"]);
const MAX_METADATA_STRING = 4096;

function numericMetric(value) {
  if (!isNumber(value) && !(isString(value) && value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function nativeUsageFromValue(value) {
  const usage = value?.usage || value?.response?.usage || value?.message?.usage || value?.data?.usage;
  if (!usage || !isObject(usage) || Array.isArray(usage)) return null;
  const input = numericMetric(usage.input_tokens ?? usage.prompt_tokens);
  const output = numericMetric(usage.output_tokens ?? usage.completion_tokens);
  const total = numericMetric(usage.total_tokens ?? usage.total_token_count);
  if (input === undefined && output === undefined && total === undefined) return null;
  const normalized = { ...usage };
  if (input !== undefined) normalized.input_tokens = input;
  else if (total !== undefined) normalized.input_tokens = Math.max(0, total - (output || 0));
  if (output !== undefined) normalized.output_tokens = output;
  else if (total !== undefined && input !== undefined) normalized.output_tokens = Math.max(0, total - input);
  if (total !== undefined) normalized.total_tokens = total;
  if (usage.prompt_tokens_details && !usage.input_tokens_details) normalized.input_tokens_details = usage.prompt_tokens_details;
  if (usage.completion_tokens_details && !usage.output_tokens_details) normalized.output_tokens_details = usage.completion_tokens_details;
  return normalized;
}

export function isNativeTerminalUsageEvent(event) {
  const type = String(event?.type || event?.event || "").toLowerCase();
  const status = String(event?.status || event?.response?.status || "").toLowerCase();
  return type === "message_stop" || /(?:completed|complete|done|finished)$/.test(type) ||
    ["completed", "complete", "done", "finished"].includes(status) ||
    ["chat.completion", "chat.completion.chunk"].includes(event?.object) && nativeUsageFromValue(event) !== null;
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

export async function recordNativeUsage({ apiKey, provider, model, connectionId, endpoint, value, usageEventId, fallbackUsage = null }) {
  if (!apiKey) return true;
  const tokens = nativeUsageFromValue(value) || fallbackUsage;
  if (!tokens || !usageEventId) return true;
  const committed = await saveRequestUsage({ apiKey, provider, model, connectionId, endpoint, tokens, usageEventId, strict: true });
  if (committed === false) throw new Error("Native usage accounting was not committed");
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
    if (!key || frames.length === 0 || frames.length > 4 || frames.some((frame) => frame.kind !== "object")) return null;
    const rootMetadata = frames.length === 1 || frames.length === 2 && METADATA_WRAPPERS.has(frames[1].segment);
    if (rootMetadata && METADATA_FIELDS.has(key)) return { metadata: key, root: frames.length === 1 };
    const usageIndex = frames[1]?.segment === "usage" ? 1 :
      WRAPPERS.has(frames[1]?.segment) && frames[2]?.segment === "usage" ? 2 : -1;
    if (usageIndex < 0 || !TOKEN_FIELDS.has(key)) return null;
    if (frames.length === usageIndex + 1) return { metric: key };
    if (frames.length === usageIndex + 2 && DETAIL_FIELDS.has(frames.at(-1).segment)) return { metric: key, detail: frames.at(-1).segment };
    return null;
  };
  const apply = (selection, value) => {
    if (!selection) return;
    if (selection.metadata) {
      if (selection.root || result[selection.metadata] === undefined) result[selection.metadata] = value;
      return;
    }
    const number = numericMetric(value);
    if (number === undefined) return;
    result.usage ||= {};
    if (selection.detail) (result.usage[selection.detail] ||= {})[selection.metric] = number;
    else result.usage[selection.metric] = number;
  };
  parser.on("data", (token) => {
    const parent = frames.at(-1);
    if (token.name === "keyValue") { if (parent) parent.key = token.value; }
    else if (token.name === "startObject" || token.name === "startArray") {
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
      apply(selectedField(parent?.key), token.value);
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
  let prefix = "";
  let dataLine = false;
  let skipSpace = false;
  let lineHasCharacters = false;
  const feedData = async (text) => {
    if (!text || ignoreEvent) return;
    if (!event) {
      const trimmed = text.trimStart();
      if (!trimmed) return;
      if (!trimmed.startsWith("{")) { ignoreEvent = true; return; }
      event = createJsonCollector();
    }
    await event.write(text);
  };
  const finishEvent = async () => {
    if (event) {
      const value = await event.finish();
      mergeEnvelope(result, value);
      await onValue?.(value, result);
    }
    event = null; ignoreEvent = false; hasData = false;
  };
  const segment = async (text) => {
    if (!text) return;
    lineHasCharacters = true;
    let offset = 0;
    if (!dataLine && prefix.length < 5) {
      const amount = Math.min(5 - prefix.length, text.length);
      prefix += text.slice(0, amount); offset = amount;
      if (prefix.length === 5 && prefix === "data:") {
        dataLine = true; skipSpace = true;
        if (hasData && event) await event.write("\n");
        hasData = true;
      }
    }
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
    async finish() { await finishEvent(); return result; },
  };
}

export function observeNativeResponse(response, details) {
  if (!response.body) return response;
  const contentType = response.headers.get("content-type") || "";
  const sse = /text\/event-stream/i.test(contentType);
  const json = /(?:application\/json|\+json)/i.test(contentType);
  const committedEvents = new Set();
  const commit = async (value) => {
    if (details.terminalOnly && !isNativeTerminalUsageEvent(value)) return;
    const resourceId = value.id || value.task_id || value.request_id || value.file_id || value.voice_id || details.resourceId || details.usageEventId;
    const usageEventId = resourceId ? `${details.provider}:${details.connectionId}:${resourceId}:terminal` : null;
    if (!usageEventId || committedEvents.has(usageEventId) || !(nativeUsageFromValue(value) || details.fallbackUsage)) return;
    await recordNativeUsage({ ...details, value, usageEventId });
    committedEvents.add(usageEventId);
  };
  const collector = sse ? createSseCollector(async (value, accumulated) => {
    await details.onValue?.(value);
    if (isNativeTerminalUsageEvent(value)) {
      await details.onComplete?.();
      await commit(accumulated);
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
      if (!sse) await details.onValue?.(value);
      await details.onComplete?.();
      // Spending the last allowance preserves success; the next admission denies it.
      await commit(value);
    },
  });
  return new Response(response.body.pipeThrough(stream), { status: response.status, statusText: response.statusText, headers: response.headers });
}
