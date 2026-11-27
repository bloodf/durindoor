// UC persona frame parsing. Port of OmniRoute c71f0065
// open-sse/executors/uc/stream.ts (UcFrameParser, detectUcSoftError,
// estimateUcTokens).
//
// Frames are newline-delimited JSON; one socket message may carry several.
//   { type: "error", code, message, next_reset }        quota / auth / rate: terminal
//   { message_type: "generation_failed", direct_mode_error }   terminal
//   { message_type: "status", status }                  progress
//   { message_type: "intermediary_message", text }      reasoning
//   { message_type: "text", text }                      answer delta
//   { message_type: "text", end_of_stream: true, raw_text }   terminal, authoritative answer
//   memory_status and anything else                     ignored
//
// Fork deviations: a frame split across socket messages is reassembled (the
// unterminated tail of one message is carried into the next, bounded); a
// carried tail that never parses is dropped like the source drops any
// non-JSON keepalive; error events carry their code; upstream text in an
// error event is capped at 300 characters (source) and redacted by the caller.
import { Buffer } from "node:buffer";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_MAX_CARRY_BYTES } from "./config.js";

export const UC_FRAME_TYPES = Object.freeze({
  error: "error",
  generationFailed: "generation_failed",
  status: "status",
  reasoning: "intermediary_message",
  text: "text",
  memoryStatus: "memory_status",
});

/** Source UC_TOP_LEVEL_ERROR_CODES. */
export const UC_TOP_LEVEL_ERROR_CODES = Object.freeze(["message_limit_exceeded", "paywall_exceeded", "rate_limit_exceeded", "unauthorized", "forbidden"]);
const TOP_LEVEL = new Set(UC_TOP_LEVEL_ERROR_CODES);
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** Source UC_SOFT_ERROR_PATTERNS. */
export const UC_SOFT_ERROR_PATTERNS = Object.freeze([
  "server overloaded temporarily",
  "please switch models and try again",
  "we are trying to resolve this asap",
  "model is temporarily unavailable",
  "temporarily over capacity",
]);

/** The trimmed text when a short answer is a capacity apology, else null. */
export function detectUcSoftError(text) {
  if (!text) return null;
  const low = text.toLowerCase();
  return text.length <= 300 && UC_SOFT_ERROR_PATTERNS.some((p) => low.includes(p)) ? text.trim() : null;
}

/** Source estimate (~4 characters per token); UC sends no usage frame. */
export function estimateUcTokens(text) {
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0;
}

function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return null;
  }
}

/** Stateful parser for one turn. feed() returns the ordered events of one socket message. */
export class UcFrameParser {
  constructor({ maxCarryBytes = UC_MAX_CARRY_BYTES } = {}) {
    this.parts = [];
    this.finished = false;
    this.carry = "";
    this.maxCarryBytes = maxCarryBytes;
  }

  get done() {
    return this.finished;
  }

  get accumulated() {
    return this.parts.join("");
  }

  /** Throws `Error("carry-too-large")` when an unterminated frame passes the cap. */
  feed(raw) {
    const events = [];
    if (this.finished || !isString(raw) || !raw) return events;
    const carried = this.carry;
    this.carry = "";
    const lines = (carried + raw).split("\n");
    const last = lines.length - 1;
    for (let i = 0; i <= last; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let frame = parseLine(line);
      if (frame === null && i === 0 && carried) {
        // The carried tail was a keepalive, not the start of this frame.
        frame = parseLine(raw.split("\n")[0].trim());
      }
      if (frame === null && i === last) {
        if (Buffer.byteLength(line) > this.maxCarryBytes) throw new Error("carry-too-large");
        this.carry = line;
        continue;
      }
      if (!frame) continue;
      if (this.consume(frame, events)) break;
    }
    return events;
  }

  /** Classify one frame; true once terminal. */
  consume(m, events) {
    const code = isString(m.code) ? m.code : "";
    if (m.type === UC_FRAME_TYPES.error || TOP_LEVEL.has(code)) {
      const effCode = CODE.test(code) ? code : "error";
      const msg = isString(m.message) ? m.message : effCode;
      const reset = m.next_reset;
      const detail = `${msg} (code=${effCode}${reset ? `, next_reset=${String(reset)}` : ""})`;
      events.push({ kind: "error", code: effCode, text: `uc_${effCode}: ${detail}`.slice(0, 300), ...(reset ? { nextReset: String(reset) } : {}) });
      this.finished = true;
      return true;
    }
    const mt = m.message_type;
    if (mt === UC_FRAME_TYPES.generationFailed) {
      events.push({ kind: "error", code: "generation_failed", text: String(m.direct_mode_error ?? m.error ?? "generation_failed").slice(0, 300) });
      this.finished = true;
      return true;
    }
    if (mt === UC_FRAME_TYPES.status) {
      events.push({ kind: "status", text: String(m.status ?? "") });
    } else if (mt === UC_FRAME_TYPES.reasoning) {
      if (isString(m.text) && m.text) events.push({ kind: "reasoning", text: m.text });
    } else if (mt === UC_FRAME_TYPES.text) {
      if (m.end_of_stream) {
        const full = (isString(m.raw_text) && m.raw_text) || this.parts.join("");
        events.push({ kind: "done", text: full.trim() });
        this.finished = true;
        return true;
      }
      if (isString(m.text) && m.text) {
        this.parts.push(m.text);
        events.push({ kind: "delta", text: m.text });
      }
    }
    return false;
  }

  /** Accumulated deltas, trimmed (source fallback). */
  finalText() {
    return this.parts.join("").trim();
  }
}
