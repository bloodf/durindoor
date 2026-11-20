/**
 * Responses API sequence-number replay suppression.
 *
 * The Responses API numbers every event of one response with a strictly
 * increasing `sequence_number`. An upstream that reconnects and replays part of
 * its stream re-sends those events with the numbers they already had, so
 * forwarding them again glues duplicated text into the client stream.
 *
 * Ported from OmniRoute #15510 (commit 408b4f2bd), which extends the #5786
 * numeric watermark to decimal-string sequence numbers. The local adaptation
 * narrows the upstream rule: only explicit Responses events are tracked, the
 * watermark is scoped to a single upstream response, and terminal, usage and
 * `[DONE]` delivery is never suppressed.
 *
 * @module open-sse/utils/responsesSequenceReplay
 */
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { isOpenAIResponsesTerminalEvent } from "./responsesStreamHelpers.js";

/** Most superseded response ids remembered per stream, so state stays constant sized. */
const MAX_SEEN_RESPONSE_IDS = 16;

/** Canonical decimal integers only: "0", "7", "42". */
const DECIMAL_SEQUENCE = /^(?:0|[1-9]\d*)$/;

/**
 * Normalize a Responses `sequence_number` to a comparable integer.
 *
 * A provider that serializes the counter as a decimal string must behave like
 * the numeric form, so both are accepted. Missing, malformed, fractional,
 * negative and out-of-range values are invalid and stay untracked.
 *
 * @param {unknown} value Raw `sequence_number` from the upstream payload.
 * @returns {number|null} The normalized counter, or null when the value is invalid.
 */
export function normalizeResponsesSequenceNumber(value) {
  if (isNumber(value)) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (isString(value) && DECIMAL_SEQUENCE.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  return null;
}

/**
 * Whether an event carries the accounting that must survive replay suppression.
 * Terminal events hold the final response snapshot and the stream's end; usage
 * events hold the token accounting.
 *
 * @param {Record<string, unknown>} payload Parsed upstream event.
 * @param {string} eventType The event's Responses type.
 * @returns {boolean} true when the event must never be suppressed.
 */
function isProtectedResponsesEvent(payload, eventType) {
  if (isOpenAIResponsesTerminalEvent(eventType, payload)) return true;
  if (isRecord(payload.usage)) return true;
  if (isRecord(payload.response?.usage)) return true;
  return false;
}

/**
 * Create the per-stream tracker for replayed Responses events.
 *
 * The tracker keeps the highest `sequence_number` already forwarded. The
 * Responses API increases that counter strictly, so an event at or below the
 * watermark was already forwarded and is a reconnect/retry replay.
 *
 * The watermark is scoped to one upstream response: a different
 * `response.id` on a non-protected event starts fresh numbering. A late
 * terminal or usage frame for another response is forwarded without changing
 * the active response or its watermark. A bounded list of superseded ids keeps
 * a replayed event of an already-seen response (such as its creation) from
 * resetting the active watermark: it is dropped as a replay, while an id never
 * seen before is a genuine new response and starts fresh numbering.
 *
 * @returns {{isReplay: (payload: unknown) => boolean}} The tracker.
 */
export function createResponsesSequenceReplayTracker() {
  let responseId = null;
  let lastSequence = -1;
  /** @type {string[]} Superseded response ids, oldest first, capped. */
  const seenResponseIds = [];

  /**
   * @param {unknown} payload Parsed upstream event.
   * @returns {boolean} true when the event replays an already-forwarded event.
   */
  function isReplay(payload) {
    if (!isRecord(payload)) return false;
    const eventType = payload.type;
    // Only explicit Responses events carry the sequence-number contract.
    if (!isString(eventType) || !eventType.startsWith("response.")) return false;

    const eventResponseId = payload.response?.id;
    if (isString(eventResponseId) && eventResponseId && eventResponseId !== responseId) {
      if (responseId !== null && isProtectedResponsesEvent(payload, eventType)) return false;
      // An already-seen response replayed after a newer one is active must not
      // take over the watermark; its creation was forwarded the first time.
      if (seenResponseIds.includes(eventResponseId)) return true;
      if (responseId !== null) {
        seenResponseIds.push(responseId);
        if (seenResponseIds.length > MAX_SEEN_RESPONSE_IDS) seenResponseIds.shift();
      }
      responseId = eventResponseId;
      lastSequence = -1;
    }

    const sequence = normalizeResponsesSequenceNumber(payload.sequence_number);
    if (sequence === null) return false;

    const replay = sequence <= lastSequence;
    if (sequence > lastSequence) lastSequence = sequence;
    if (replay && isProtectedResponsesEvent(payload, eventType)) return false;
    return replay;
  }

  return { isReplay };
}
