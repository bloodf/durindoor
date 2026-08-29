import { MAX_COMPRESS_BODY_BYTES } from "../config/runtimeConfig.js";
import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest } from
"../translator/request/openai-responses.js";
import {
  getHeadroomCircuitState,
  getHeadroomStatusStats,
  incrementHeadroomFailures,
  resetHeadroomCircuit } from
"./headroomCircuit.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const DEFAULT_TIMEOUT_MS = 15000;

export {
  getHeadroomCircuitState,
  getHeadroomStatusStats,
  resetHeadroomCircuit } from
"./headroomCircuit.js";

/** Return a finite positive timeout, preserving the fork's 15-second default. */
function normalizeTimeout(value) {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.input)) return body.input;
  const kiro = collectKiroHeadroomMessages(body);
  if (kiro) return kiro.messages;
  return null;
}

function captureSizeSnapshot(body) {
  const messages = messagePayload(body);
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0
  };
}
function sanitizeReason(text) {
  return scrubSensitiveUrlText(String(text ?? "").trim().replace(/\s+/g, " ")).slice(0, 200);
}

/** Require a candidate request body to shrink by more than five percent. */
function hasMeaningfulByteShrink(beforeBytes, candidate) {
  return jsonBytes(candidate) < beforeBytes * 0.95;
}

/** Return whether proxy output preserves OpenAI message ordering and tool routing identity. */
function preservesOpenAIConversationContract(sourceMessages, candidateMessages, diagnostics) {
  if (!Array.isArray(candidateMessages) || candidateMessages.length !== sourceMessages.length) {
    setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
    return false;
  }
  for (let i = 0; i < sourceMessages.length; i += 1) {
    const source = sourceMessages[i] || {};
    const candidate = candidateMessages[i] || {};
    if (candidate.role !== source.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve message count or order");
      return false;
    }
    const sourceHasCalls = Array.isArray(source.tool_calls) && source.tool_calls.length > 0;
    const candidateHasCalls = Array.isArray(candidate.tool_calls) && candidate.tool_calls.length > 0;
    const content = candidate.content;
    if ((content === null || content === undefined) && !sourceHasCalls && !candidateHasCalls) {
      setDiagnostic(diagnostics, "proxy response did not preserve message content shape");
      return false;
    }
    if (content !== null && content !== undefined && !isString(content) && !Array.isArray(content) && !isObject(content)) {
      setDiagnostic(diagnostics, "proxy response did not preserve message content shape");
      return false;
    }
    if ((source.tool_call_id != null || candidate.tool_call_id != null) &&
        String(candidate.tool_call_id ?? "") !== String(source.tool_call_id ?? "")) {
      setDiagnostic(diagnostics, "proxy response did not preserve tool pairing identity");
      return false;
    }
    if (sourceHasCalls || candidateHasCalls) {
      if (!Array.isArray(candidate.tool_calls) || candidate.tool_calls.length !== (source.tool_calls?.length ?? 0)) {
        setDiagnostic(diagnostics, "proxy response did not preserve tool pairing identity");
        return false;
      }
      for (let j = 0; j < source.tool_calls.length; j += 1) {
        const expected = source.tool_calls[j] || {};
        const actual = candidate.tool_calls[j] || {};
        if (String(actual.id ?? "") !== String(expected.id ?? "") ||
            String(actual.type ?? "function") !== String(expected.type ?? "function") ||
            String(actual.function?.name ?? "") !== String(expected.function?.name ?? "") ||
            String(actual.function?.arguments ?? "") !== String(expected.function?.arguments ?? "")) {
          setDiagnostic(diagnostics, "proxy response did not preserve tool pairing identity");
          return false;
        }
      }
    }
  }
  return true;
}

function containsCcrMarker(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    try { return JSON.stringify(message).includes("<<ccr:"); } catch { return false; }
  });
}

function hasCcrHashes(data) {
  return Array.isArray(data?.ccr_hashes) && data.ccr_hashes.length > 0;
}

function setDiagnostic(diagnostics, reason, code) {
  if (!diagnostics || diagnostics.reason) return;
  diagnostics.reason = sanitizeReason(reason);
  if (code) diagnostics.code = code;
}

function scrubSensitiveUrlText(text) {
  return String(text).
  replace(/\/\/[^/@\s]+@/g, "//").
  replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code;
  const message = scrubSensitiveUrlText(cause?.message || error?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).replace(/#.*$/, "");
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${base.replace(/\/$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(endpoint).replace(/\/\/[^/@\s]+@/, "//").replace(/[?#].*$/, "");
  }
}

function hasUnsafeResponsesInputForCompression(body) {
  if (!Array.isArray(body?.input)) return false;
  return body.input.some((item) => {
    if (!item || !isObject(item) || Array.isArray(item)) return false;
    if (item.type === "function_call_output" && (item.status === "error" || item.is_error === true)) return true;
    return isString(item.type) && item.type !== "message";
  });
}

// Skip only explicit provider error shapes; content containing "error" is safe.
function hasErrorToolBlock(body, format) {
  try {
    for (const message of body?.messages || []) {
      const content = message?.content;
      const parts = Array.isArray(content) ? content : isObject(content) ? [content] : [];
      for (const part of parts) {
        if ((part?.type === "tool_result" || message?.role === "tool") &&
            (part?.is_error === true || part?.status === "error")) return true;
      }
      if (message?.role === "tool" && (message.is_error === true || message.status === "error")) return true;
    }
    const state = body?.conversationState;
    if (state && isObject(state)) {
      const items = [...(Array.isArray(state.history) ? state.history : []), state.currentMessage].filter(Boolean);
      for (const item of items) {
        const results = item?.userInputMessage?.userInputMessageContext?.toolResults;
        if (Array.isArray(results) && results.some((result) => result?.status === "error" || result?.isError === true)) return true;
      }
    }
    if (format === "openai-responses" && Array.isArray(body?.input)) {
      return body.input.some((item) => item?.type === "function_call_output" &&
        (item.status === "error" || item.is_error === true));
    }
  } catch { /* malformed optional fields fail open */ }
  return false;
}

/**
 * Project a Kiro `conversationState` body into OpenAI-shaped messages for the
 * Headroom proxy, recording a write-back target (object + key) per emitted
 * message so compressed text can be copied into the original Kiro fields.
 *
 * @param {object} body Kiro request body carrying `conversationState`.
 * @returns {{messages: object[], targets: {object: object, key: string}[]} | null}
 *   Projection (parallel `messages`/`targets` arrays) or null when no text-bearing
 *   Kiro messages were found.
 */
function collectKiroHeadroomMessages(body) {
  const state = body?.conversationState;
  if (!state || !isObject(state)) return null;

  const messages = [];
  const targets = [];

  const addTextTarget = (role, text, target, extra = {}) => {
    if (!isString(text)) return;
    messages.push({ role, content: text, ...extra });
    targets.push(target);
  };

  const toToolCalls = (toolUses) => {
    if (!Array.isArray(toolUses) || toolUses.length === 0) return undefined;
    const calls = toolUses.map((toolUse) => ({
      id: toolUse?.toolUseId,
      type: "function",
      function: {
        name: toolUse?.name || "",
        arguments: JSON.stringify(toolUse?.input || {})
      }
    })).filter((call) => call.id || call.function.name);
    return calls.length > 0 ? calls : undefined;
  };

  const visit = (item) => {
    const user = item?.userInputMessage;
    if (user) {
      addTextTarget("system", user.systemInstruction, { object: user, key: "systemInstruction" });
      addTextTarget("user", user.content, { object: user, key: "content" });

      const toolResults = user.userInputMessageContext?.toolResults;
      if (Array.isArray(toolResults)) {
        for (const toolResult of toolResults) {
          const content = toolResult?.content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            addTextTarget(
              "tool",
              part?.text,
              { object: part, key: "text" },
              toolResult?.toolUseId ? { tool_call_id: toolResult.toolUseId } : {}
            );
          }
        }
      }
      return;
    }

    const assistant = item?.assistantResponseMessage;
    if (assistant) {
      const toolCalls = toToolCalls(assistant.toolUses);
      addTextTarget(
        "assistant",
        assistant.content,
        { object: assistant, key: "content" },
        toolCalls ? { tool_calls: toolCalls } : {}
      );
    }
  };

  if (Array.isArray(state.history)) {
    for (const item of state.history) visit(item);
  }
  if (state.currentMessage) visit(state.currentMessage);

  return messages.length > 0 ? { messages, targets } : null;
}

/**
 * Extract plain text from a Headroom proxy message whose `content` may be a
 * string or an array of string/`{text}` parts.
 *
 * @param {object} message Compressed message returned by the proxy.
 * @returns {string | null} Joined text, or null when no text content is present.
 */
function textFromHeadroomMessage(message) {
  const content = message?.content;
  if (isString(content)) return content;
  if (!Array.isArray(content)) return null;

  const parts = [];
  for (const part of content) {
    if (isString(part)) {
      parts.push(part);
    } else if (isString(part?.text)) {
      parts.push(part.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Stable identity key for a Kiro-projected message, derived only from IDs
 * already present on the wire (tool `tool_call_id`, assistant `tool_calls[].id`).
 * Returns null when the message carries no comparable ID (plain user/system
 * turns) — those stay role-checked only.
 *
 * @param {object} message Projected or proxy-returned message.
 * @returns {string | null} Identity key, or null when none is available.
 */
function kiroMessageIdentity(message) {
  if (!message || !isObject(message)) return null;
  if (message.role === "tool" && isString(message.tool_call_id)) {
    return `tool:${message.tool_call_id}`;
  }
  if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const ids = message.tool_calls.map((call) => call?.id).filter((id) => isString(id)).sort();
    if (ids.length > 0) return `assistant:${ids.join(",")}`;
  }
  return null;
}

/**
 * Validate the proxy response against the Kiro projection (count + role order
 * + per-index identity where the wire carries IDs), then write each compressed
 * text back into its recorded Kiro field. Fail-open: any mismatch returns false
 * without mutating the body.
 *
 * ponytail: identity check covers tool/assistant turns (they carry IDs on the
 * wire); adjacent plain user/system turns have no stable ID, so a same-role
 * reorder there is only role-guarded. Upgrade path = round-trip an ordinal
 * synthetic id through the proxy (changes wire bytes) if headroom ever reorders
 * user turns in practice.
 *
 * @param {{messages: object[], targets: {object: object, key: string}[]}} projection
 *   Output of {@link collectKiroHeadroomMessages}.
 * @param {object[]} compressedMessages Messages returned by the Headroom proxy.
 * @param {object} [diagnostics] Optional diagnostics sink; `reason` is set on failure.
 * @returns {boolean} True when the body was updated; false to fail open.
 */
function applyKiroHeadroomMessages(projection, compressedMessages, diagnostics) {
  if (!Array.isArray(compressedMessages) || compressedMessages.length !== projection.messages.length) {
    setDiagnostic(diagnostics, "proxy response did not match Kiro message count");
    return false;
  }

  const updates = [];
  const seenIdentities = new Set();
  for (let i = 0; i < projection.messages.length; i++) {
    const expected = projection.messages[i];
    const actual = compressedMessages[i];
    if (!actual || actual.role !== expected.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve Kiro message order");
      return false;
    }
    const expectedId = kiroMessageIdentity(expected);
    if (expectedId !== null) {
      // Duplicate non-null identity = two projected parts share one wire id
      // (e.g. multiple text parts in a single toolResult). They cannot be
      // disambiguated positionally, so fail open rather than risk writing
      // compressed text into the wrong part.
      if (seenIdentities.has(expectedId)) {
        setDiagnostic(diagnostics, "proxy response has ambiguous Kiro message identity");
        return false;
      }
      seenIdentities.add(expectedId);
      if (expectedId !== kiroMessageIdentity(actual)) {
        setDiagnostic(diagnostics, "proxy response did not preserve Kiro message identity");
        return false;
      }
    }

    const text = textFromHeadroomMessage(actual);
    if (text === null) {
      setDiagnostic(diagnostics, "proxy response missing Kiro text content");
      return false;
    }
    updates.push({ target: projection.targets[i], text });
  }

  for (const update of updates) {
    update.target.object[update.target.key] = update.text;
  }
  return true;
}
// POST messages to Headroom /v1/compress exactly once, then fail open.
async function callCompress(url, messages, model, timeoutMs, compressUserMessages, diagnostics) {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  if (getHeadroomCircuitState().degraded) {
    setDiagnostic(diagnostics, "proxy circuit is degraded", "proxy-down");
    return null;
  }
  const payload = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      incrementHeadroomFailures();
      setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`, "http-status");
      return null;
    }
    const data = await res.json();
    resetHeadroomCircuit();
    if (hasCcrHashes(data) || containsCcrMarker(data?.messages)) {
      setDiagnostic(diagnostics, "rejected: response contains CCR markers");
      return null;
    }
    if (data?.compression_skipped === true || (data?.skip_reason && !Array.isArray(data?.messages))) {
      setDiagnostic(diagnostics, data.skip_reason || "compression_skipped");
      return null;
    }
    if (!Array.isArray(data?.messages)) {
      incrementHeadroomFailures();
      setDiagnostic(diagnostics, "proxy response missing messages[]");
      return null;
    }
    const tokensBefore = Number(data.tokens_before);
    const tokensAfter = Number(data.tokens_after);
    const tokensSaved = Number(data.tokens_saved);
    if (Number.isFinite(tokensSaved) && tokensSaved <= 0) {
      setDiagnostic(diagnostics, data.skip_reason || "no token saving — keeping original");
      return null;
    }
    if (Number.isFinite(tokensBefore) && Number.isFinite(tokensAfter)) {
      if (tokensAfter > tokensBefore) {
        setDiagnostic(diagnostics, "conflicting token metrics — keeping original");
        return null;
      }
      if (tokensAfter >= tokensBefore * 0.95) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% tokens)");
        return null;
      }
    }
    return data;
  } catch (error) {
    incrementHeadroomFailures();
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
}

/**
 * Compress a request through Headroom, failing open without mutating the body
 * when disabled, invalid, oversized, or when translation/proxy work fails.
 *
 * @returns {Promise<object|null>} Compression stats, or null when bypassed.
 */
export async function compressWithHeadroom(body, { enabled, url, model, format, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics = null } = {}) {
  timeoutMs = normalizeTimeout(timeoutMs);
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    const sizeSnapshot = captureSizeSnapshot(body);
    if (diagnostics) diagnostics.before = sizeSnapshot;
    if (sizeSnapshot.bodyBytes > MAX_COMPRESS_BODY_BYTES) {
      setDiagnostic(diagnostics, `skipped: payload too large (${sizeSnapshot.bodyBytes}B > ${MAX_COMPRESS_BODY_BYTES}B limit)`);
      return null;
    }
    if (hasErrorToolBlock(body, format)) {
      setDiagnostic(diagnostics, "skipped: error tool result present — headroom not applied");
      return null;
    }

    // Claude shape: translate → OpenAI → compress → translate back.
    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]", "translation-failed");
        return null;
      }
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      if (!preservesOpenAIConversationContract(oai.messages, data.messages, diagnostics)) return null;
      const claudeBody = openaiToClaudeRequest(model, { ...oai, messages: data.messages }, false);
      if (!Array.isArray(claudeBody?.messages) || claudeBody.messages.length !== body.messages.length ||
          claudeBody.messages.some((message, index) => message?.role !== body.messages[index]?.role ||
            (!isString(message?.content) && !Array.isArray(message?.content)))) {
        setDiagnostic(diagnostics, "proxy response did not preserve Claude message shape");
        return null;
      }
      const candidate = { ...body, messages: claudeBody.messages };
      if (claudeBody.system !== undefined) candidate.system = claudeBody.system;
      if (!hasMeaningfulByteShrink(sizeSnapshot.bodyBytes, candidate)) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
      body.messages = claudeBody.messages;
      if (claudeBody.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI Responses shape (Codex): body.input holds Responses items, NOT OpenAI
    // messages. Translate input -> OpenAI -> compress -> translate back to input so
    // body.input keeps the Responses contract (the proxy only understands OpenAI). (#1998)
    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(diagnostics, "skipped: openai-responses tool/reasoning input is not safe to compress");
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model, body, false);
      /** Preserve the translation failure reason while Headroom fails open. */
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "openai-responses request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      /** Reject reordered or identity-altered proxy output before Responses translation can mutate the request. */
      if (!preservesOpenAIConversationContract(oai.messages, data.messages, diagnostics)) return null;
      const responsesBody = openaiToOpenAIResponsesRequest(
        model,
        { ...oai, input: undefined, messages: data.messages },
        false
      );
      if (!Array.isArray(responsesBody?.input)) {
        setDiagnostic(diagnostics, "Responses translation did not produce compressed input");
        return null;
      }
      if (!hasMeaningfulByteShrink(sizeSnapshot.bodyBytes, { ...body, input: responsesBody.input })) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
      body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Kiro shape: conversationState.history/currentMessage are projected to
    // OpenAI messages for the proxy, then copied back into the original Kiro
    // fields. Keep the provider payload shape intact for Kiro's executor.
    if (format === "kiro") {
      const projection = collectKiroHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "Kiro request did not project to messages[]");
        return null;
      }
      const data = await callCompress(url, projection.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      /** Apply write-back to a full-body copy so byte savings and identity are proven before mutation. */
      const candidate = structuredClone(body);
      const candidateProjection = collectKiroHeadroomMessages(candidate);
      if (!candidateProjection || !applyKiroHeadroomMessages(candidateProjection, data.messages, diagnostics)) return null;
      if (!hasMeaningfulByteShrink(sizeSnapshot.bodyBytes, candidate)) {
        setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
        return null;
      }
      if (!applyKiroHeadroomMessages(projection, data.messages, diagnostics)) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI shape: messages/input go straight to the proxy.
    const key = Array.isArray(body.messages) ? "messages" :
    Array.isArray(body.input) ? "input" :
    null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const sourceMessages = body[key];
    const data = await callCompress(url, sourceMessages, model, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    if (!preservesOpenAIConversationContract(sourceMessages, data.messages, diagnostics)) return null;
    if (!hasMeaningfulByteShrink(sizeSnapshot.bodyBytes, { ...body, [key]: data.messages })) {
      setDiagnostic(diagnostics, "phantom savings — keeping original (>95% size)");
      return null;
    }
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error) {
    setDiagnostic(diagnostics, `unexpected error: ${error?.message || String(error)}`, "translation-failed");
    return null;
  }
}

export function formatHeadroomLog(stats) {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const delta = stats.tokens_saved || 0;
  const pct = before > 0 ? (delta / before * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B`;
}

export function isHeadroomPhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}

/**
 * Classify a Headroom outcome into a dashboard-safe category (matches upstream
 * decolua/9router #2562 exactly). The raw `diagnostics.reason` string can embed
 * URLs, HTTP statuses, and upstream error text; persisting it would leak that
 * into the aggregate dashboard. This maps it to one allowlisted enum value.
 *
 * @param {object} diagnostics The diagnostics sink passed to compressWithHeadroom.
 * @param {object|null} stats The compressWithHeadroom return (null on skip).
 * @param {boolean} enabled Whether Headroom was enabled for the request.
 * @returns {string} One of: compressed, disabled, missing-proxy-url, request-failed,
 *   timeout, http-error, unsafe-responses-input, translation-failed, unsupported-shape,
 *   invalid-proxy-response, unexpected-error, other-skip.
 */
export function classifyHeadroomDiagnostic(diagnostics, stats, enabled) {
  if (stats) return "compressed";
  if (!enabled) return "disabled";
  if (diagnostics?.code === "proxy-down") return "proxy-down";
  if (diagnostics?.code === "http-status") return "http-status";
  if (diagnostics?.code === "translation-failed") return "translation-failed";

  const reason = String(diagnostics?.reason || "").toLowerCase();
  if (reason.includes("missing proxy url")) return "missing-proxy-url";
  if (reason.includes("timeout") || reason.includes("abort")) return "timeout";
  if (reason.includes("request failed")) return "request-failed";
  if (reason.includes("proxy returned http")) return "http-error";
  if (reason.includes("openai-responses tool/reasoning")) return "unsafe-responses-input";
  if (reason.includes("did not translate") || reason.includes("translate to messages")) return "translation-failed";
  if (reason.includes("unsupported") || reason.includes("did not project")) return "unsupported-shape";
  if (reason.includes("proxy response")) return "invalid-proxy-response";
  if (reason.includes("unexpected error")) return "unexpected-error";
  return "other-skip";
}