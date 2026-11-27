// Per-invocation reply state of fal's HTTP over WebSockets protocol: one text
// `start` control frame, raw body frames, one text `end` control frame.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/httpWebsocketReply.ts (FalHttpWebsocketReply: a text
// frame whose JSON is a record with `type` "start"/"end" is a control frame,
// every other frame is body; `start` needs a pending invocation, no open
// response, a string `request_id`, an object `headers` and an integer status
// 100..599, and is emitted as `http-start`; the body is capped at 32 MiB; an
// event-stream body is parsed as SSE and its native events are emitted as
// they arrive; `end` needs the open response's `request_id` and emits `error`
// when either status is >= 400, else `http-end` for SSE and `final` for any
// other body; JSON/text bodies go through normalizeFalOutput, other bodies
// become one file artifact named from Content-Disposition) and
// open-sse/handlers/fal/events.ts (createFalEventParser: SSE lines split on
// CR, LF or CRLF, comments ignored, `data` lines joined with LF and parsed as
// JSON when possible, an 8 MiB pending-event cap, and a stream that ends in
// the middle of an event is an error).
//
// Fork deviations: a missing artifact hook stores binary bodies as a data URI
// (as the realtime bundle does); `request_id` is capped at 256 characters;
// every protocol violation throws one fixed message so no upstream text
// reaches an error.
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { normalizeFalRealtimeOutput } from "../native-fal-realtime/realtime.js";
import { FAL_HTTP_WEBSOCKET_LIMITS } from "./config.js";

const MAX_REQUEST_ID = 256;

/** A protocol violation; its message is fixed and never includes upstream text. */
export class FalHttpWebsocketProtocolError extends Error {
  constructor() {
    super("Invalid or oversized Fal HTTP WebSocket response");
    this.name = "FalHttpWebsocketProtocolError";
  }
}
const violation = () => new FalHttpWebsocketProtocolError();

function parseNativeData(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** SSE framing without repair heuristics (source createFalEventParser). */
export function createFalEventParser(emit, maxEventBytes = FAL_HTTP_WEBSOCKET_LIMITS.maxEventBytes) {
  let pending = "";
  let event = "message";
  let id;
  let data = [];
  let dataLength = 0;
  function line(value) {
    if (!value) {
      if (data.length) {
        const out = { event, data: parseNativeData(data.join("\n")) };
        if (id !== undefined) out.id = id;
        emit(out);
      }
      data = [];
      dataLength = 0;
      event = "message";
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
    if (field === "data") {
      data.push(content);
      dataLength += content.length + 1;
    }
    if (field === "event") event = content;
    if (field === "id" && !content.includes("\0")) id = content;
  }
  return {
    push(text) {
      pending += text;
      let offset = 0;
      for (let i = 0; i < pending.length; i++) {
        if (pending[i] !== "\n" && pending[i] !== "\r") continue;
        if (pending[i] === "\r" && i + 1 === pending.length) break;
        line(pending.slice(offset, i));
        if (pending[i] === "\r" && pending[i + 1] === "\n") i++;
        offset = i + 1;
      }
      pending = pending.slice(offset);
      if (pending.length + dataLength > maxEventBytes) throw violation();
    },
    finish() {
      if (pending === "\r") {
        line("");
        pending = "";
      }
      if (pending || data.length) throw violation();
    },
  };
}

function httpStatus(value) {
  if (!isNumber(value) || !Number.isInteger(value) || value < 100 || value > 599) throw violation();
  return value;
}

function header(start, name) {
  const entry = Object.entries(start.headers).find(([key]) => key.toLowerCase() === name);
  return entry === undefined || entry[1] === undefined || entry[1] === null ? "" : String(entry[1]);
}

// A text frame that is a JSON record is a control candidate; anything else is body.
function control(bytes, binary) {
  if (binary) return {};
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

const isJsonOrText = (type) => /^(text\/|application\/(json|[^;]+\+json))/.test(type);

/**
 * Reply state for one HTTP-WebSocket session. `consume` throws
 * FalHttpWebsocketProtocolError on any violation; the session then fails.
 */
export class FalHttpWebsocketReply {
  /**
   * @param {(event: string, data: unknown) => void} emit
   * @param {((bytes: Uint8Array, type: string, name: string) => string) | undefined} artifact
   * @param {() => void} completed - called after each `end`
   * @param {{ maxResponseBytes: number, maxEventBytes: number }} [limits]
   */
  constructor(emit, artifact, completed, limits = FAL_HTTP_WEBSOCKET_LIMITS) {
    this.pending = false;
    this.emit = emit;
    this.artifact = isFunction(artifact) ? artifact : undefined;
    this.completed = completed;
    this.limits = limits;
    this.reset();
  }

  reset() {
    this.current = null;
    this.chunks = [];
    this.size = 0;
    this.decoder = new TextDecoder();
    this.parser = createFalEventParser((event) => this.emit(event.event, event.data), this.limits.maxEventBytes);
  }

  /** One inbound frame as `Uint8Array` bytes. */
  consume(bytes, binary) {
    const frame = control(bytes, binary);
    if (frame.type === "start") return this.start(frame);
    if (frame.type === "end") return this.end(frame);
    if (!this.current || !this.pending) throw violation();
    this.size += bytes.byteLength;
    if (this.size > this.limits.maxResponseBytes) throw violation();
    if (header(this.current, "content-type").includes("text/event-stream")) this.parser.push(this.decoder.decode(bytes, { stream: true }));
    else this.chunks.push(Buffer.from(bytes));
  }

  start(frame) {
    if (this.current || !this.pending || !isString(frame.request_id) || frame.request_id.length > MAX_REQUEST_ID || !isRecord(frame.headers)) throw violation();
    this.current = { id: frame.request_id, status: httpStatus(frame.status), headers: frame.headers };
    this.emit("http-start", frame);
  }

  text(type) {
    const text = Buffer.concat(this.chunks).toString("utf8");
    if (type.includes("json")) {
      try {
        return JSON.parse(text);
      } catch {
        // Preserve native non-JSON error text.
      }
    }
    return text;
  }

  result(start) {
    const type = header(start, "content-type") || "application/octet-stream";
    if (type.includes("text/event-stream")) {
      this.parser.push(this.decoder.decode());
      this.parser.finish();
      // The SSE events already carried the model output; the end is metadata only.
      return {};
    }
    if (isJsonOrText(type)) return normalizeFalRealtimeOutput(this.text(type));
    const name = header(start, "content-disposition").match(/filename="?([^";]+)"?/)?.[1] ?? "fal-output";
    const bytes = Buffer.concat(this.chunks);
    const url = this.artifact ? this.artifact(new Uint8Array(bytes), type, name) : `data:${type};base64,${bytes.toString("base64")}`;
    const file = { url, file_name: name, content_type: type };
    return { output: { file }, artifacts: [{ ...file, path: "$.file" }] };
  }

  end(frame) {
    const start = this.current;
    if (!start || !this.pending || frame.request_id !== start.id) throw violation();
    const failed = start.status >= 400 || httpStatus(frame.status) >= 400;
    const streaming = header(start, "content-type").includes("text/event-stream");
    const data = { ...this.result(start), http: { ...start, ...frame } };
    if (!streaming) data.partial = false;
    if (failed) data.error = "Fal upstream HTTP response failed";
    this.emit(failed ? "error" : streaming ? "http-end" : "final", data);
    this.pending = false;
    this.reset();
    this.completed();
  }

  dispose() {
    this.chunks = [];
  }
}
