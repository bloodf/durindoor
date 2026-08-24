import { FORMATS } from "../translator/formats.js";
import { GEMINI_ERROR_FINISH_REASONS } from "../translator/schema/finishReasons.js";
import { buildAbortedResponsesTerminalBytes } from "./responsesStreamHelpers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

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
    if (chunk?.error || chunk?.response?.error) return fail();
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

/** Validate a fully buffered provider response before clearing runtime health. */
export function isCoherentNonStreamingResponse(chunk, format = FORMATS.OPENAI) {
  if (!chunk || !isObject(chunk) || chunk.error || chunk.type === "error") return false;
  if ([FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSE, FORMATS.CODEX].includes(format)) {
    const status = responseStatus(chunk);
    return ["completed", "incomplete"].includes(status) && Array.isArray(chunk.output);
  }
  if (format === FORMATS.CLAUDE) {
    if (isCoherentOpenAICompletion(chunk)) return true;
    return chunk.type === "message" && (
    Array.isArray(chunk.content) || chunk.content === null) && isString(
      chunk.stop_reason) &&
    chunk.stop_reason.length > 0;
  }
  if ([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY].includes(format)) {
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

/**
 * Track terminal events emitted to the client. This intentionally stays
 * separate from createUpstreamTerminalTracker, which observes raw provider
 * frames for account-health accounting.
 */
const clientTerminalEncoder = new TextEncoder();

export function createTerminalTracker(format) {
  if (![FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE].includes(format)) return null;
  let terminated = false;

  return {
    observeClientFrame(frame) {
      if (terminated || !frame) return;
      if (format === FORMATS.OPENAI) {
        terminated = /^data: \[DONE\]/m.test(frame) ||
        /"finish_reason"\s*:\s*"[^"\n]+"/.test(frame) ||
        /"error"\s*:\s*\{/.test(frame);
      } else if (format === FORMATS.CLAUDE) {
        terminated = /^event: (message_stop|error)/m.test(frame) ||
        frame.includes('"type":"message_stop"') ||
        frame.includes('"type":"error"');
      } else {
        terminated = /^event: (response\.(completed|done|incomplete|failed|cancelled|canceled)|error)/m.test(frame) ||
        /^data: \[DONE\]/m.test(frame) ||
        frame.includes('"type":"error"');
      }
    },
    buildRecoveryBytes() {
      if (terminated) return null;
      terminated = true;
      if (format === FORMATS.OPENAI) {
        return clientTerminalEncoder.encode('data: {"error":{"type":"stream_error","message":"upstream_stream_incomplete","code":"stream_disconnected"}}\n\ndata: [DONE]\n\n');
      }
      if (format === FORMATS.CLAUDE) {
        return clientTerminalEncoder.encode('event: error\ndata: {"type":"error","error":{"type":"stream_error","message":"Upstream stream ended before completing"}}\n\n');
      }
      return buildAbortedResponsesTerminalBytes();
    }
  };
}