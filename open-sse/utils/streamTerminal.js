import { FORMATS, GEMINI_FAMILY_FORMATS } from "../translator/formats.js";
import { CLAUDE_STOP, GEMINI_ERROR_FINISH_REASONS, OPENAI_FINISH } from "../translator/schema/finishReasons.js";
import { buildAbortedResponsesTerminalBytes } from "./responsesStreamHelpers.js";
import { isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const RESPONSES_SUCCESS_EVENTS = new Set([
"response.completed",
"response.done",
"response.incomplete"]
);
const RESPONSES_FAILURE_EVENTS = new Set([
"response.failed",
"response.cancelled",
"response.canceled",
"error"]
);

const MASKED_GATEWAY_ERROR_REASONS = new Set([
"network_error",
"error",
"server_error",
"timeout"
]);

export function choiceHasOutput(choice) {
  const message = choice?.message || choice?.delta || {};
  const hasToolCall = Array.isArray(message.tool_calls) &&
  message.tool_calls.some((toolCall) => isString(toolCall?.function?.name) && toolCall.function.name.length > 0);
  return isString(message.content) && message.content.trim().length > 0 ||
  Array.isArray(message.content) && message.content.length > 0 ||
  isString(message.reasoning_content) && message.reasoning_content.trim().length > 0 ||
  isString(message.reasoning) && message.reasoning.trim().length > 0 ||
  isString(message.audio?.data) && message.audio.data.length > 0 ||
  hasToolCall ||
  isString(message.function_call?.name) && message.function_call.name.length > 0;
}

/** Return an upstream error reason hidden inside an otherwise successful OpenAI response. */
export function classifyMaskedGatewayError(response) {
  for (const choice of response?.choices || []) {
    const reason = isString(choice?.native_finish_reason) ? choice.native_finish_reason.toLowerCase() : null;
    if (MASKED_GATEWAY_ERROR_REASONS.has(reason) && !choiceHasOutput(choice)) return reason;
  }
  return null;
}

function responseEventName(eventName, chunk) {
  if (isString(eventName) && eventName) return eventName;
  return isString(chunk?.type) ? chunk.type : null;
}

function responseEventTypes(eventName, chunk) {
  return [
  isString(eventName) && eventName ? eventName : null,
  isString(chunk?.type) && chunk.type ? chunk.type : null].
  filter(Boolean);
}

function responseStatus(chunk) {
  return String(chunk?.response?.status || chunk?.status || "").toLowerCase();
}

function geminiCandidates(chunk) {
  if (Array.isArray(chunk?.candidates)) return chunk.candidates;
  if (Array.isArray(chunk?.response?.candidates)) return chunk.response.candidates;
  return [];
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Track an application-level terminal found in the original upstream frames.
 *
 * Client-side terminals synthesized by translators or by EOF recovery never
 * pass through this tracker. A failure is sticky, and the success callback is
 * emitted at most once.
 */
export function createUpstreamTerminalTracker({ format = null, onCoherentTerminal = null, expectedChoiceCount = null, expectedCandidateCount = null, deferSuccessCallback = false } = {}) {
  let outcome = "pending";
  let fired = false;
  let successKind = null;
  const seenChoices = new Set();
  const finishedChoices = new Set();
  const seenCandidates = new Set();
  const finishedCandidates = new Set();
  let expectedChoices = positiveInteger(expectedChoiceCount) || 1;
  let expectedCandidates = positiveInteger(expectedCandidateCount);
  let specialTerminalSeen = false;
  let applicationTerminalSeen = false;
  let rawDoneSeen = false;
  let openAIUsageTrailerSeen = false;

  const fail = () => {
    outcome = "failure";
    return false;
  };
  const succeed = (kind) => {
    if (outcome === "failure") return false;
    outcome = "success";
    successKind = kind;
    if (!deferSuccessCallback && !fired) {
      fired = true;
      try {onCoherentTerminal?.({ kind });} catch {/* success cleanup is fail-open */}
    }
    return true;
  };
  const succeedApplication = (kind) => {
    applicationTerminalSeen = true;
    return succeed(kind);
  };

  const allOpenAIChoicesFinished = () => {
    const required = expectedChoices || seenChoices.size;
    return required > 0 &&
    finishedChoices.size >= required &&
    [...seenChoices].every((index) => finishedChoices.has(index));
  };

  function observeOpenAI(chunk, rawDone) {
    if (chunk?.error || chunk?.type === "error") return fail();
    if (rawDone) {
      rawDoneSeen = true;
      if (!allOpenAIChoicesFinished()) return fail();
      return succeed("openai_done");
    }
    if (!Array.isArray(chunk?.choices)) return false;
    if (chunk.choices.length === 0) {
      if (
      chunk?.usage && isObject(chunk.usage) &&
      allOpenAIChoicesFinished() &&
      !openAIUsageTrailerSeen)
      {
        openAIUsageTrailerSeen = true;
        return false;
      }
      return allOpenAIChoicesFinished() || chunk?.usage ? fail() : false;
    }
    expectedChoices = positiveInteger(chunk.n ?? chunk.choice_count ?? chunk.choiceCount) || expectedChoices;
    for (const [position, choice] of chunk.choices.entries()) {
      const index = Number.isSafeInteger(choice?.index) ? choice.index : position;
      if (finishedChoices.has(index)) return fail();
      seenChoices.add(index);
      if (choice?.finish_reason === "error") return fail();
      if (isString(choice?.finish_reason) && choice.finish_reason) finishedChoices.add(index);
    }
    return false;
  }

  function observeResponses(chunk, eventName) {
    if (chunk?.error || chunk?.response?.error) return fail();
    const types = responseEventTypes(eventName, chunk);
    const type = responseEventName(eventName, chunk);
    const status = responseStatus(chunk);
    if (types.some((candidate) => RESPONSES_FAILURE_EVENTS.has(candidate)) || ["failed", "cancelled", "canceled"].includes(status)) return fail();
    if (
    types.length > 1 &&
    types[0] !== types[1] &&
    types.some((candidate) => RESPONSES_SUCCESS_EVENTS.has(candidate) || RESPONSES_FAILURE_EVENTS.has(candidate)))
    return fail();
    if (!RESPONSES_SUCCESS_EVENTS.has(type)) return false;
    if (type === "response.incomplete") {
      return !status || status === "incomplete" ? succeedApplication("responses_incomplete") : fail();
    }
    return !status || status === "completed" ?
    succeedApplication("responses_completed") :
    fail();
  }

  function observeClaude(chunk, eventName) {
    const eventType = isString(eventName) ? eventName : null;
    if (eventType === "error" || chunk?.type === "error" || chunk?.error) return fail();
    if (eventType && chunk?.type && eventType !== chunk.type) return fail();
    return eventType === "message_stop" || chunk?.type === "message_stop" ?
    succeedApplication("claude_message_stop") :
    false;
  }

  function observeGemini(chunk) {
    if (chunk?.error || chunk?.response?.error || geminiPromptFeedbackError(chunk)) return fail();
    const promptBlock = chunk?.promptFeedback?.blockReason || chunk?.response?.promptFeedback?.blockReason;
    if (promptBlock) return succeedApplication("gemini_prompt_block");
    const candidates = geminiCandidates(chunk);
    expectedCandidates = positiveInteger(
      chunk?.candidate_count ?? chunk?.candidateCount ??
      chunk?.response?.candidate_count ?? chunk?.response?.candidateCount
    ) || expectedCandidates;
    for (const [position, candidate] of candidates.entries()) {
      const index = Number.isSafeInteger(candidate?.index) ? candidate.index : position;
      seenCandidates.add(index);
      const reason = candidate?.finishReason || candidate?.finish_reason;
      if (GEMINI_ERROR_FINISH_REASONS.has(reason)) return fail();
      if (isString(reason) && reason) finishedCandidates.add(index);
    }
    const required = expectedCandidates || seenCandidates.size;
    return required > 0 && finishedCandidates.size >= required && [...seenCandidates].every((index) => finishedCandidates.has(index)) ?
    succeedApplication("gemini_finish") :
    false;
  }

  function observeOllama(chunk) {
    if (chunk?.error) return fail();
    return chunk?.done === true ? succeedApplication("ollama_done") : false;
  }

  function observeSpecial(chunk) {
    if (specialTerminalSeen) return fail();
    if (chunk?.error || chunk?.type === "error") return fail();
    if (format === FORMATS.COMMANDCODE && chunk?.type === "finish") {
      return succeedApplication("commandcode_finish");
    }
    if (format === FORMATS.KIRO) {
      const type = chunk?.eventType || chunk?.type;
      if (type === "messageStopEvent" || type === "done" || chunk?.messageStopEvent) {
        return succeedApplication("kiro_finish");
      }
    }
    if (Array.isArray(chunk?.choices)) {
      for (const choice of chunk.choices) {
        if (choice?.finish_reason === "error") return fail();
        if (isString(choice?.finish_reason) && choice.finish_reason) specialTerminalSeen = true;
      }
    }
    return false;
  }

  return {
    fail,
    finalize() {
      if (outcome !== "success" || fired) return false;
      fired = true;
      try {onCoherentTerminal?.({ kind: successKind });} catch {/* success cleanup is fail-open */}
      return true;
    },
    observe({ chunk = null, eventName = null, rawDone = false } = {}) {
      if (outcome === "failure") return false;
      if (rawDone && isString(eventName) && eventName.trim()) return fail();
      if (rawDoneSeen) return fail();
      const isResponses = format === FORMATS.OPENAI_RESPONSES ||
      format === FORMATS.OPENAI_RESPONSE ||
      format === FORMATS.CODEX;
      if (isResponses) {
        if (rawDone) {
          if (!applicationTerminalSeen || outcome !== "success") return fail();
          rawDoneSeen = true;
          return true;
        }
        if (applicationTerminalSeen && chunk != null) return fail();
        return observeResponses(chunk, eventName);
      }
      if (format === FORMATS.CLAUDE) {
        if (rawDone || applicationTerminalSeen && chunk != null) return fail();
        return observeClaude(chunk, eventName);
      }
      if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY].includes(format)) {
        if (rawDone || applicationTerminalSeen && chunk != null) return fail();
        return observeGemini(chunk);
      }
      if (format === FORMATS.OLLAMA) {
        if (rawDone || applicationTerminalSeen && chunk != null) return fail();
        return observeOllama(chunk);
      }
      if ([FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR].includes(format)) {
        if (applicationTerminalSeen && (rawDone || chunk != null)) return fail();
        if (rawDone) {
          rawDoneSeen = true;
          return specialTerminalSeen ? succeed("provider_done") : fail();
        }
        return observeSpecial(chunk);
      }
      return observeOpenAI(chunk, rawDone);
    },
    get outcome() {return outcome;},
    get fired() {return fired;}
  };
}

/** Gemini error nested in promptFeedback: a failure, never a prompt-block success (#1342). */
function geminiPromptFeedbackError(chunk) {
  return chunk?.promptFeedback?.error || chunk?.response?.promptFeedback?.error;
}

function isCoherentOpenAICompletion(chunk) {
  return Array.isArray(chunk?.choices) &&
  chunk.choices.length > 0 &&
  chunk.choices.every((choice) =>
  choice && isString(
    choice.finish_reason) &&
  choice.finish_reason.length > 0 &&
  choice.finish_reason !== "error" && (
  choice.message && isObject(choice.message) || isString(choice.text))
  );
}

/** Recognize an explicit token limit on a completion with the expected wire shape. */
export function hasTokenLimitCompletion(response) {
  if (Array.isArray(response?.choices)) {
    return response.choices.some((choice) =>
      choice?.finish_reason === OPENAI_FINISH.LENGTH && isRecord(choice.message));
  }
  return response?.type === "message" && Array.isArray(response.content) &&
    response.stop_reason === CLAUDE_STOP.MAX_TOKENS;
}

/** Validate a fully buffered provider response before clearing runtime health. */
export function isCoherentNonStreamingResponse(chunk, format = FORMATS.OPENAI) {
  if (!chunk || !isObject(chunk) || chunk.error || chunk.type === "error") return false;
  if ([FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE].includes(format)) {
    const status = responseStatus(chunk);
    if (["queued", "in_progress"].includes(status)) {
      return chunk.object === "response" && isString(chunk.id) && chunk.id.trim().length > 0;
    }
    return ["completed", "incomplete"].includes(status) && Array.isArray(chunk.output);
  }
  if (format === FORMATS.CODEX) {
    return ["completed", "incomplete"].includes(responseStatus(chunk)) && Array.isArray(chunk.output);
  }
  if (format === FORMATS.CLAUDE) {
    if (isCoherentOpenAICompletion(chunk)) return true;
    return chunk.type === "message" && (
    Array.isArray(chunk.content) || chunk.content === null) && isString(
      chunk.stop_reason) &&
    chunk.stop_reason.length > 0;
  }
  if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY].includes(format)) {
    if (geminiPromptFeedbackError(chunk)) return false;
    const promptBlock = chunk?.promptFeedback?.blockReason || chunk?.response?.promptFeedback?.blockReason;
    if (promptBlock) return true;
    const candidates = geminiCandidates(chunk);
    return candidates.length > 0 && candidates.every((candidate) => {
      const reason = candidate?.finishReason || candidate?.finish_reason;
      return isString(reason) && reason.length > 0 && !GEMINI_ERROR_FINISH_REASONS.has(reason);
    });
  }
  if (format === FORMATS.OLLAMA) return chunk.done === true;

  return isCoherentOpenAICompletion(chunk);
}

const RESPONSES_SUCCESS_TERMINALS = new Set(["response.completed", "response.done"]);
const RESPONSES_CLOSED_TERMINALS = new Set([
  "response.failed",
  "response.incomplete",
  "response.cancelled",
  "response.canceled",
  "error",
]);

function frameData(frame) {
  const match = frame.match(/^data:\s*(.*)$/m);
  return match ? match[1].replace(/\r$/, "").trim() : null;
}

function frameEvent(frame, payload) {
  const eventLine = frame.match(/^event:\s*(\S+)/m)?.[1] || null;
  return eventLine || (isString(payload?.type) ? payload.type : null);
}

function parseFramePayload(data) {
  if (!isString(data) || data.length === 0 || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** OpenAI finish_reason is progress, not the client end. A later usage frame can still follow. */
function openAIFinishReasonSeen(format, frame) {
  if (format !== FORMATS.OPENAI || !isString(frame)) return false;
  for (const line of frame.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = parseFramePayload(trimmed.slice(5).trim());
    if (!isRecord(payload) || !Array.isArray(payload.choices)) continue;
    for (const choice of payload.choices) {
      if (isString(choice?.finish_reason) && choice.finish_reason.length > 0) return true;
    }
  }
  return false;
}

/** Gemini's real end is a candidate that already carries its finish reason. */
function geminiClientTerminalKind(payload) {
  if (!isRecord(payload)) return null;
  if (geminiPromptFeedbackError(payload)) return "failure";
  const promptBlock = payload.promptFeedback?.blockReason || payload.response?.promptFeedback?.blockReason;
  if (isString(promptBlock) && promptBlock.length > 0) return "success";
  const candidates = geminiCandidates(payload);
  if (candidates.length === 0) return null;
  let failure = false;
  for (const candidate of candidates) {
    const reason = candidate?.finishReason || candidate?.finish_reason;
    if (!isString(reason) || reason.length === 0) return null;
    if (GEMINI_ERROR_FINISH_REASONS.has(reason)) failure = true;
  }
  return failure ? "failure" : "success";
}

/**
 * Real end of one emitted client frame.
 *
 * OpenAI ends on `[DONE]` or an in-band error object, never on `finish_reason`
 * (a usage trailer can still follow that frame). Claude ends on `message_stop`.
 * Responses ends on `response.completed` / `response.failed` and the other
 * Responses terminal events. Gemini ends when the candidate is final.
 *
 * `success` and `done` are empty-completion candidates. `failure` has ended
 * the stream and must be forwarded unchanged.
 *
 * @returns {"success"|"done"|"failure"|null}
 */
export function emittedFormatTerminalKind(format, frame) {
  if (!isString(frame) || frame.length === 0) return null;
  const data = frameData(frame);
  if (data === "[DONE]" || /^data: \[DONE\]/m.test(frame)) return "done";
  const payload = parseFramePayload(data);
  const event = frameEvent(frame, payload);

  if (format === FORMATS.OPENAI) {
    return isRecord(payload?.error) || /"error"\s*:\s*\{/.test(frame) ? "failure" : null;
  }
  if (format === FORMATS.CLAUDE) {
    if (event === "message_stop" || frame.includes('"type":"message_stop"')) return "success";
    if (event === "error" || frame.includes('"type":"error"') || /^event: error/m.test(frame)) return "failure";
    return null;
  }
  if (format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE || format === FORMATS.CODEX) {
    if (RESPONSES_SUCCESS_TERMINALS.has(event)) return "success";
    if (RESPONSES_CLOSED_TERMINALS.has(event) || frame.includes('"type":"error"')) return "failure";
    return null;
  }
  if (GEMINI_FAMILY_FORMATS.has(format)) return geminiClientTerminalKind(payload);
  return null;
}

/**
 * Track terminal events emitted to the client. This intentionally stays
 * separate from createUpstreamTerminalTracker, which observes raw provider
 * frames for account-health accounting.
 */
const clientTerminalEncoder = new TextEncoder();

export function createTerminalTracker(format) {
  if (![FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE].includes(format)) return null;
  let terminated = false;
  let sawOpenAIFinish = false;

  return {
    observeClientFrame(frame) {
      if (terminated || !frame) return;
      if (emittedFormatTerminalKind(format, frame) !== null) {
        terminated = true;
        return;
      }
      if (openAIFinishReasonSeen(format, frame)) sawOpenAIFinish = true;
    },
    /**
     * @param {{drop?: boolean}} [options] `drop` is a network or abort close.
     * A clean EOF after an OpenAI finish_reason is a finished translation
     * (that format does not always emit `[DONE]`). A drop after the same
     * frame is still incomplete: usage and `[DONE]` never arrived.
     */
    buildRecoveryBytes(options) {
      if (terminated) return null;
      const drop = isRecord(options) && options.drop === true;
      if (sawOpenAIFinish && !drop) {
        terminated = true;
        return null;
      }
      terminated = true;
      if (format === FORMATS.OPENAI) {
        return clientTerminalEncoder.encode('data: {"error":{"type":"stream_error","message":"upstream_stream_incomplete","code":"stream_disconnected"}}\n\ndata: [DONE]\n\n');
      }
      if (format === FORMATS.CLAUDE) {
        // Claude clients retry an in-band overloaded_error and end the turn on any
        // other type; a stalled or dropped upstream is transient.
        return clientTerminalEncoder.encode('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Upstream stream ended before completing"}}\n\n');
      }
      return buildAbortedResponsesTerminalBytes();
    }
  };
}