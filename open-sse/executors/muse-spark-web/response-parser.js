import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";export function isRecord(value) {
  return !!value && isObject(value) && !Array.isArray(value);
}

export function parseMetaSseFrames(text) {
  const frames = [];
  const lines = text.split(/\r?\n/);
  let currentEvent = "message";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0 && currentEvent === "message") return;
    frames.push({ event: currentEvent, data: dataLines.join("\n").trim() });
    currentEvent = "message";
    dataLines = [];
  };
  for (const line of lines) {
    if (!line) {
      flush();
    } else if (line.startsWith(":")) {
      continue;
    } else if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim() || "message";
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  flush();
  return frames;
}

export function readMetaJsonPayloads(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  }
  return parseMetaSseFrames(text).
  map((frame) => {
    try {
      const parsed = JSON.parse(frame.data);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }).
  filter(Boolean);
}

function collectRendererTexts(value, seen = new Set(), depth = 0) {
  if (depth > 8) return [];
  if (isString(value)) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectRendererTexts(item, seen, depth + 1));
  if (!isRecord(value)) return [];
  const parts = [];
  if (isString(value.text)) parts.push(...collectRendererTexts(value.text, seen, depth + 1));
  for (const key of ["contentRenderer", "textContent", "message", "mediaContent", "unified_response", "unifiedResponseContent", "sections", "view_model", "primitive", "primitives", "nested_responses"]) {
    if (key in value) parts.push(...collectRendererTexts(value[key], seen, depth + 1));
  }
  return parts;
}

function collectReasoningTexts(value, seen = new Set(), depth = 0, force = false) {
  if (depth > 8) return [];
  if (isString(value)) {
    const normalized = value.trim();
    if (!force || !normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectReasoningTexts(item, seen, depth + 1, force));
  if (!isRecord(value)) return [];
  const typename = isString(value.__typename) ? value.__typename : "";
  const localForce = force || /reasoning|thinking|thought/i.test(typename);
  const parts = [];
  if (isString(value.text) && localForce) parts.push(...collectReasoningTexts(value.text, seen, depth + 1, true));
  for (const key of ["reasoning", "reasoningContent", "reasoning_content", "reasoningText", "thinking", "thinkingContent", "thinkingText", "thought", "thoughtText", "thoughts", "internalThoughts", "chainOfThought", "thinkingTrace", "thinking_trace"]) {
    if (key in value) parts.push(...collectReasoningTexts(value[key], seen, depth + 1, true));
  }
  for (const key of ["contentRenderer", "textContent", "message", "mediaContent", "unified_response", "unifiedResponseContent", "sections", "view_model", "primitive", "primitives", "nested_responses"]) {
    if (key in value) parts.push(...collectReasoningTexts(value[key], seen, depth + 1, localForce));
  }
  return parts;
}

function extractAssistantContent(message) {
  if (isString(message.content) && message.content.length > 0) return message.content;
  return collectRendererTexts(isRecord(message.contentRenderer) ? message.contentRenderer : null).join("\n\n").trim();
}

function extractAssistantReasoning(message) {
  return collectReasoningTexts(message).join("\n\n").trim();
}

export function parseMetaAiResponseText(text, isThinkingModel) {
  let lastContent = "";
  const deltas = [];
  let lastReasoning = "";
  const reasoningDeltas = [];
  let errorMessage = null;
  let errorCode = null;
  for (const payload of readMetaJsonPayloads(text)) {
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors.find((item) => isRecord(item) && isString(item.message));
      if (first) errorMessage = first.message.trim();
    }
    const stream = isRecord(payload.data?.sendMessageStream) ? payload.data.sendMessageStream : null;
    if (!stream || stream.__typename !== "AssistantMessage") continue;
    const content = extractAssistantContent(stream);
    if (content && content !== lastContent) {
      deltas.push(content.startsWith(lastContent) ? content.slice(lastContent.length) : content);
      lastContent = content;
    }
    if (isThinkingModel) {
      const reasoning = extractAssistantReasoning(stream);
      if (reasoning && reasoning !== content && reasoning !== lastReasoning) {
        reasoningDeltas.push(reasoning.startsWith(lastReasoning) ? reasoning.slice(lastReasoning.length) : reasoning);
        lastReasoning = reasoning;
      }
    }
    if (isRecord(stream.error)) {
      errorCode = isString(stream.error.code) ? stream.error.code : errorCode;
      errorMessage = isString(stream.error.message) ? stream.error.message.trim() : errorMessage;
    }
  }
  const combined = `${errorMessage || ""}\n${lastContent}`.trim();
  if (/authentication required to send messages|login is required|sign in/i.test(combined)) {
    return { content: lastContent, deltas, reasoningContent: lastReasoning, reasoningDeltas, errorCode, errorMessage: "Meta AI auth failed; the ecto_1_sess cookie may be expired.", status: 401 };
  }
  if (/limit exceeded|rate limit|too many requests/i.test(combined)) {
    return { content: lastContent, deltas, reasoningContent: lastReasoning, reasoningDeltas, errorCode, errorMessage: "Meta AI rate limited the session. Wait and retry.", status: 429 };
  }
  if (errorMessage) return { content: lastContent, deltas, reasoningContent: lastReasoning, reasoningDeltas, errorCode, errorMessage: `Meta AI returned an error: ${errorMessage}`, status: 502 };
  if (!lastContent) return { content: "", deltas: [], reasoningContent: lastReasoning, reasoningDeltas, errorCode: null, errorMessage: "Meta AI returned no assistant content", status: 502 };
  return { content: lastContent, deltas: deltas.filter(Boolean), reasoningContent: lastReasoning, reasoningDeltas: reasoningDeltas.filter(Boolean), errorCode: null, errorMessage: null, status: 200 };
}