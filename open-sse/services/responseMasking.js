// Opt-in masking of provider responses (#1479). Reuses the request rule set
// and `contentMasking` setting from contentMasking.js (#1112).
//
// Runs once at chatCore's client boundary, after format translation, so it
// walks the shape the client parses: Chat Completions, Responses, Claude
// Messages and Gemini (incl. the `{response: ...}` envelope), JSON and SSE.
// Only visible text is rewritten. Tool calls, tool ids, function names, tool
// arguments, signed thinking/reasoning and JSON structure are never touched.
//
// Streams keep a bounded carry per output index (Chat choice, Responses
// output/content index, Claude block, Gemini candidate) so a secret split
// across deltas is still matched. The carry is flushed, masked, before the
// block ends, at stream end, and when the upstream stream errors. Responses
// `*.done` events and the final snapshot reuse the exact text already sent.
//
// Modes: off returns the result object untouched; warn passes the response
// bytes through unchanged and logs counts; mask rewrites text. Only per-type
// counts are logged, never matched values.

import { maskText, normalizeMaskingMode } from "./contentMasking.js";
import { extractCompleteSseFrames } from "../utils/streamHelpers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Raw text held back per stream key. 128 chars covers the length at which
// every rule becomes recognisable; a match still straddling the cut keeps the
// hold growing until it completes, up to MAX_CARRY_CHARS.
export const CARRY_CHARS = 128;
// ponytail: past these a straddling match is cut anyway; raise if a real secret needs more.
export const MAX_CARRY_CHARS = 32768;
// Total raw text held across every index of one stream.
export const MAX_TOTAL_CARRY_CHARS = 65536;
const KEY_BEGIN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const KEY_END_RE = /-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const RESPONSES_TERMINAL = new Set(["response.completed", "response.incomplete", "response.failed"]);

/** Never cut between the two UTF-16 halves of one character (e.g. an emoji). */
function keepPair(raw, cut) {
  const code = raw.charCodeAt(cut - 1);
  return cut > 0 && code >= 0xd800 && code <= 0xdbff ? cut - 1 : cut;
}

/**
 * Length of the raw prefix that can be emitted without splitting a match.
 * `force` (total cap reached) cuts regardless. Probes always replace, so warn
 * mode finds the same safe cuts as mask mode.
 */
function safeCut(raw, opts, force) {
  const cut = keepPair(raw, raw.length - CARRY_CHARS);
  if (cut <= 0) return 0;
  if (force || raw.length > MAX_CARRY_CHARS) return cut;
  const begin = raw.search(KEY_BEGIN_RE);
  if (begin !== -1 && begin < cut && !KEY_END_RE.test(raw.slice(begin))) return begin;
  const probeOpts = { ...opts, replace: true };
  const probe = {};
  const whole = maskText(raw, probeOpts, probe);
  return maskText(raw.slice(0, cut), probeOpts, probe) + maskText(raw.slice(cut), probeOpts, probe) === whole ? cut : 0;
}

/**
 * Per-stream carry state. `before` collects synthesized flush payloads with
 * their frame serializer. Warn mode scans the same windows as mask mode and
 * drops text once scanned, so it holds no more than mask mode does.
 */
export function createIo(opts, counts, mask) {
  const pending = new Map();
  // Only Responses done events and snapshots replay sent text, so only
  // Responses keys keep it; `streamed` marks every key already counted.
  const emitted = new Map();
  const streamed = new Set();
  const templates = new Map();
  const before = [];
  let held = 0;
  const hold = (key, raw) => {
    held += raw.length - (pending.get(key)?.length ?? 0);
    if (raw) pending.set(key, raw);
    else pending.delete(key);
  };
  const record = (key, text) => {
    streamed.add(key);
    if (mask && key.startsWith("resp/")) emitted.set(key, (emitted.get(key) ?? "") + text);
  };
  const take = (key) => {
    const raw = pending.get(key);
    hold(key, "");
    if (!raw) return "";
    const out = maskText(raw, opts, counts);
    record(key, out);
    return out;
  };
  const io = {
    before,
    take,
    held: () => held,
    emittedKeys: () => [...emitted.keys()],
    // Set per frame by processFrame: serializes a payload into that frame's lines.
    wrap: null,
    feed(key, text, template) {
      const wrap = io.wrap;
      templates.set(key, (t) => ({ wrap, payload: template(t) }));
      const raw = (pending.get(key) ?? "") + text;
      const cut = safeCut(raw, opts, held + text.length > MAX_TOTAL_CARRY_CHARS);
      hold(key, raw.slice(cut));
      const out = cut ? maskText(raw.slice(0, cut), opts, counts) : "";
      record(key, out);
      return mask ? out : text;
    },
    flush(prefix) {
      for (const key of [...pending.keys()]) {
        if (!key.startsWith(prefix)) continue;
        const out = take(key);
        if (out) before.push(templates.get(key)(out));
      }
    },
    final(key, text) {
      if (!streamed.has(key)) return isString(text) ? maskText(text, opts, counts) : text;
      return mask ? emitted.get(key) ?? "" : text;
    },
    // Responses sequence numbers: synthesized frames get their own number and
    // every later frame shifts by the count inserted so far.
    seqShift: 0,
    lastSeq: null
  };
  return io;
}

function setField(obj, field, value) {
  if (obj[field] === value) return false;
  obj[field] = value;
  return true;
}

function maskResponsesItem(item, oi, final) {
  if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) return false;
  let changed = false;
  item.content.forEach((part, ci) => {
    if (isObject(part) && part.type === "output_text" && isString(part.text)) {
      changed = setField(part, "text", final(`resp/${oi}/${ci}/`, part.text)) || changed;
    }
  });
  return changed;
}

function maskResponsesOutput(output, final) {
  if (!Array.isArray(output)) return false;
  return output.map((item, oi) => maskResponsesItem(item, oi, final)).some(Boolean);
}

function responsesEvent(p, io) {
  const key = `resp/${p.output_index}/${p.content_index}/`;
  switch (p.type) {
    case "response.output_text.delta":
      if (!isString(p.delta)) return false;
      return setField(p, "delta", io.feed(key, p.delta, (t) => ({ ...p, delta: t })));
    case "response.output_text.done":
      io.flush(key);
      return isString(p.text) && setField(p, "text", io.final(key, p.text));
    case "response.content_part.done":
      io.flush(key);
      return isObject(p.part) && p.part.type === "output_text" && isString(p.part.text) &&
        setField(p.part, "text", io.final(key, p.part.text));
    case "response.output_item.done":
      io.flush(`resp/${p.output_index}/`);
      return maskResponsesItem(p.item, p.output_index, io.final);
    default:
      if (!RESPONSES_TERMINAL.has(p.type)) return false;
      io.flush("resp/");
      return isObject(p.response) && maskResponsesOutput(p.response.output, io.final);
  }
}

function claudeEvent(p, io) {
  if (p.type === "content_block_delta" && p.delta?.type === "text_delta" && isString(p.delta.text)) {
    const text = io.feed(`claude/${p.index}/`, p.delta.text, (t) => ({ ...p, delta: { ...p.delta, text: t } }));
    return setField(p.delta, "text", text);
  }
  if (p.type === "content_block_stop") io.flush(`claude/${p.index}/`);
  else if (p.type === "message_delta" || p.type === "message_stop") io.flush("claude/");
  return false;
}

function chatChunk(p, io) {
  let changed = false;
  p.choices.forEach((choice, i) => {
    if (!isObject(choice)) return;
    const key = `chat/${choice.index ?? i}/`;
    const delta = isObject(choice.delta) ? choice.delta : null;
    const ends = choice.finish_reason != null || Boolean(delta?.tool_calls || delta?.function_call);
    if (delta && isString(delta.content)) {
      const template = (t) => ({ ...p, choices: [{ index: choice.index ?? i, delta: { content: t }, finish_reason: null }], usage: undefined });
      let text = io.feed(key, delta.content, template);
      if (ends) text += io.take(key);
      changed = setField(delta, "content", text) || changed;
    } else if (ends) {
      io.flush(key);
    }
  });
  return changed;
}

function geminiChunk(p, cands, io) {
  let changed = false;
  cands.forEach((cand, i) => {
    if (!isObject(cand)) return;
    const key = `gem/${cand.index ?? i}/`;
    const template = (t) => {
      const c = { ...cand, content: { ...cand.content, parts: [{ text: t }] }, finishReason: undefined };
      return p.response ? { ...p, response: { ...p.response, candidates: [c], usageMetadata: undefined } } : { ...p, candidates: [c], usageMetadata: undefined };
    };
    let lastText = null;
    const flushBeforePart = () => {
      if (lastText) changed = setField(lastText, "text", lastText.text + io.take(key)) || changed;
      else io.flush(key);
    };
    for (const part of Array.isArray(cand.content?.parts) ? cand.content.parts : []) {
      if (!isObject(part) || part.thought) continue;
      if (isString(part.text)) {
        changed = setField(part, "text", io.feed(key, part.text, template)) || changed;
        lastText = part;
      } else {
        flushBeforePart();
      }
    }
    if (cand.finishReason) flushBeforePart();
  });
  return changed;
}

function maskEvent(p, io) {
  if (!isObject(p)) return false;
  if (isString(p.type) && p.type.startsWith("response.")) return responsesEvent(p, io);
  if (isString(p.type) && (p.type.startsWith("content_block_") || p.type.startsWith("message_"))) return claudeEvent(p, io);
  if (Array.isArray(p.choices)) return chatChunk(p, io);
  const cands = p.candidates ?? p.response?.candidates;
  return Array.isArray(cands) ? geminiChunk(p, cands, io) : false;
}

/** Rewrite one SSE frame. Returns the frames to send, flush frames first. */
function processFrame(frame, io) {
  const eol = frame.includes("\r\n") ? "\r\n" : "\n";
  const lines = frame.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith("data:"));
  if (idx === -1) return [frame];
  const value = lines[idx].slice(5).trimStart();
  const withData = (payload) => lines.map((l, i) => i === idx ? `data: ${JSON.stringify(payload)}` : l).join(eol);
  io.wrap = withData;
  if (value === "[DONE]") {
    io.flush("");
    return [...drainBefore(io, null), frame];
  }
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    return [frame];
  }
  let changed = maskEvent(payload, io);
  const synthesized = drainBefore(io, payload);
  if (Number.isInteger(payload?.sequence_number)) {
    const seq = payload.sequence_number + io.seqShift;
    changed = setField(payload, "sequence_number", seq) || changed;
    io.lastSeq = seq;
  }
  return [...synthesized, changed ? withData(payload) : frame];
}

/** Serialize pending flush payloads, numbering Responses ones in order. */
function drainBefore(io, current) {
  const seqOf = Number.isInteger(current?.sequence_number) ? current.sequence_number + io.seqShift
    : Number.isInteger(io.lastSeq) ? io.lastSeq + 1 : null;
  let next = seqOf;
  return io.before.splice(0).map(({ wrap, payload }) => {
    if (next !== null && Number.isInteger(payload.sequence_number)) {
      payload.sequence_number = next++;
      io.seqShift++;
      if (!current) io.lastSeq = payload.sequence_number;
    }
    return wrap(payload);
  });
}

function summarize(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total, summary: Object.entries(counts).map(([k, n]) => `${k}:${n}`).join(",") };
}

function createMaskingStream(source, { opts, counts, mask, report }) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const io = createIo(opts, counts, mask);
  let buffer = "";
  const toBytes = (frames) => encoder.encode(frames.map((f) => `${f}${f.includes("\r\n") ? "\r\n\r\n" : "\n\n"}`).join(""));
  // Warn mode never alters bytes, so a scanning failure only stops counting.
  const scan = (fn) => {
    if (mask) return fn();
    try {
      return fn();
    } catch {
      return [];
    }
  };
  // Remaining partial frame plus every held carry, masked.
  const tail = () => scan(() => {
    const frames = buffer ? processFrame(buffer, io) : [];
    buffer = "";
    io.flush("");
    return [...frames, ...drainBefore(io, null)];
  });
  const finish = (controller) => {
    const frames = tail();
    if (mask && frames.length) controller.enqueue(toBytes(frames));
    report();
  };
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          // Upstream aborted: send the masked carry, then propagate the error.
          finish(controller);
          controller.error(error);
          return;
        }
        if (chunk.done) {
          buffer += decoder.decode();
          finish(controller);
          controller.close();
          return;
        }
        const value = isString(chunk.value) ? encoder.encode(chunk.value) : chunk.value;
        if (!mask) controller.enqueue(value);
        buffer += decoder.decode(value, { stream: true });
        const batch = extractCompleteSseFrames(buffer);
        buffer = batch.remainder;
        const frames = scan(() => batch.frames.flatMap((f) => processFrame(f, io)));
        if (!mask) return;
        if (frames.length) {
          controller.enqueue(toBytes(frames));
          return;
        }
      }
    },
    cancel(reason) {
      report();
      return reader.cancel(reason);
    }
  });
}

function maskJsonBody(p, opts, counts) {
  if (!isObject(p)) return false;
  const mask = (obj, field) => isString(obj[field]) && setField(obj, field, maskText(obj[field], opts, counts));
  const maskParts = (parts, isText) => Array.isArray(parts) &&
    parts.map((part) => isObject(part) && isText(part) && mask(part, "text")).some(Boolean);
  let changed = false;
  if (Array.isArray(p.choices)) {
    for (const choice of p.choices) {
      const msg = choice?.message;
      if (!isObject(msg)) continue;
      changed = (isString(msg.content) ? mask(msg, "content") : maskParts(msg.content, (x) => x.type === "text")) || changed;
    }
  }
  if (p.object === "response") {
    changed = maskResponsesOutput(p.output, (_k, t) => maskText(t, opts, counts)) || changed;
    changed = mask(p, "output_text") || changed;
  }
  if (p.type === "message") changed = maskParts(p.content, (x) => x.type === "text") || changed;
  const cands = p.candidates ?? p.response?.candidates;
  if (Array.isArray(cands)) {
    for (const cand of cands) changed = maskParts(cand?.content?.parts, (x) => !x.thought) || changed;
  }
  return changed;
}

/**
 * Mask a chatCore handler result before it reaches the client.
 * @param {{success?: boolean, response?: Response}|null|undefined} result
 * @param {{mode?: string, credentials?: boolean, pii?: boolean}|null} config the `contentMasking` setting
 * @param {object} [log]
 */
export async function applyResponseMasking(result, config, log) {
  const mode = normalizeMaskingMode(config?.mode);
  if (mode !== "warn" && mode !== "mask") return result;
  if (!result || result.success === false || !result.response?.body) return result;
  const mask = mode === "mask";
  let opts;
  try {
    opts = { credentials: config.credentials !== false, pii: config.pii !== false, replace: mask };
  } catch (error) {
    // Same contract as request masking: mask fails closed, warn fails open.
    if (mask) throw error;
    log?.warn?.("MASKING", "response scan skipped: unreadable contentMasking settings");
    return result;
  }
  const counts = {};
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    const { total, summary } = summarize(counts);
    if (total > 0) log?.warn?.("MASKING", `response ${mask ? "masked" : "detected"} ${total} (${summary})`);
  };
  const { response } = result;
  const headers = new Headers(response.headers);
  const contentType = (headers.get("content-type") || "").toLowerCase();
  const rebuild = (body) => ({ ...result, response: new Response(body, { status: response.status, statusText: response.statusText, headers }) });

  if (contentType.includes("text/event-stream")) {
    if (mask) headers.delete("content-length");
    return rebuild(createMaskingStream(response.body, { opts, counts, mask, report }));
  }
  if (!contentType.includes("application/json")) return result;

  const bytes = await response.arrayBuffer();
  let parsed;
  let changed = false;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
    changed = maskJsonBody(parsed, opts, counts);
  } catch (error) {
    if (mask && parsed !== undefined) throw error;
    return rebuild(bytes);
  }
  report();
  if (!mask || !changed) return rebuild(bytes);
  headers.delete("content-length");
  return rebuild(JSON.stringify(parsed));
}
