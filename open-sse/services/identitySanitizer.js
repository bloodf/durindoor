// Identity sanitizer (opt-in via DURINDOOR_SANITIZE_IDENTITY=1). Neutralises
// harness/gateway names ("OpenClaw", "OmniRoute", "DurinDoor") in system-prompt
// text and tool descriptions sent upstream. Pure, deterministic, idempotent and
// fail-safe. Never touches user/assistant/tool messages, tool names, schema
// structure or tool-call arguments. Paths and commands (~/.openclaw,
// `openclaw ...`, lowercase tokens) are left as-is on purpose.
// Port of OmniRoute #20992 adapted to DurinDoor's JS layout.

import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const isRec = isRecord;

const LITERALS = [
  [" running inside OpenClaw.", "."],
  ["## OpenClaw Control", "## Control"],
  ["OpenClaw&apos;s", "the platform&apos;s"],
  ["OpenClaw’s", "the platform’s"],
  ["OpenClaw's", "the platform's"],
];

const WORDS = [
  ["OpenClaw", "the platform"],
  ["OmniRoute", "the gateway"],
  ["DurinDoor", "the gateway"],
  ["OPENCLAW", "PLATFORM"],
];

const isAlnum = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// A token embedded in an identifier, path, URL host, handle or code span is a
// reference, not prose: leave it alone.
function embedded(c, after) {
  return isAlnum(c) || c === 95 || c === 45 || c === 47 ||
    (!after && (c === 46 || c === 126 || c === 64 || c === 58 || c === 96));
}

function wordSweep(s, word, repl) {
  let from = s.indexOf(word);
  if (from < 0) return s;
  let out = "";
  let last = 0;
  const n = word.length;
  while (from >= 0) {
    const p = from > 0 ? s.charCodeAt(from - 1) : 32;
    const q = from + n < s.length ? s.charCodeAt(from + n) : 32;
    if (!embedded(p, false) && !embedded(q, true)) {
      out += s.slice(last, from) + repl;
      last = from + n;
    }
    from = s.indexOf(word, from + n);
  }
  return out + s.slice(last);
}

function stripMarkers(s) {
  if (s.indexOf("openclaw:attempt:") < 0) return s;
  let out = "";
  let i = 0;
  for (;;) {
    const a = s.indexOf("<!--", i);
    if (a < 0) break;
    const b = s.indexOf("-->", a);
    if (b < 0) break;
    const body = s.slice(a + 4, b);
    if (body.length < 80 && /^\s*\/?openclaw:attempt:[A-Z]+\s*$/.test(body)) {
      out += s.slice(i, a);
      i = b + 3;
      if (s.charCodeAt(i) === 10) i++;
    } else {
      out += s.slice(i, b + 3);
      i = b + 3;
    }
  }
  return out + s.slice(i);
}

function isOpenClawHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "openclaw.ai" || host.endsWith(".openclaw.ai");
  } catch {
    return false;
  }
}

const URL_RE = /https?:\/\/[^\s)"<>`\]]+/g;

function stripUrls(s) {
  if (s.indexOf("openclaw.ai") < 0) return s;
  return s.replace(URL_RE, (u) => (isOpenClawHost(u) ? "(link omitted)" : u));
}

// Fenced blocks and inline code spans (commands, paths) are never rewritten.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/;

function sanitizeProse(s) {
  let t = stripUrls(stripMarkers(s));
  for (const [a, b] of LITERALS) if (t.indexOf(a) >= 0) t = t.split(a).join(b);
  for (const [word, repl] of WORDS) t = wordSweep(t, word, repl);
  return t;
}

const NAME_RE = /OpenClaw|OmniRoute|DurinDoor|openclaw|OPENCLAW/;

export function sanitizeText(s) {
  if (!isString(s) || s.length < 8 || !NAME_RE.test(s)) return s;
  return s.split(CODE_RE).map((part, i) => (i % 2 ? part : sanitizeProse(part))).join("");
}

function textBlocks(v) {
  if (isString(v)) return sanitizeText(v);
  if (!Array.isArray(v)) return v;
  let changed = false;
  const out = v.map((b) => {
    if (isString(b)) {
      const r = sanitizeText(b);
      if (r !== b) changed = true;
      return r;
    }
    if (isRec(b) && isString(b.text)) {
      const r = sanitizeText(b.text);
      if (r !== b.text) {
        changed = true;
        return { ...b, text: r };
      }
    }
    return b;
  });
  return changed ? out : v;
}

// Keywords whose value is instance data, not a schema: never rewritten.
const INSTANCE_KEYS = new Set(["enum", "const", "default", "examples", "example"]);
// Keywords whose value maps arbitrary names to schemas (a name may collide with a keyword).
const NAME_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function mapRec(v, fn) {
  let out = null;
  for (const k of Object.keys(v)) {
    const r = fn(k, v[k]);
    if (r !== v[k]) (out ??= { ...v })[k] = r;
  }
  return out ?? v;
}

function schemaKey(k, x, depth) {
  if (INSTANCE_KEYS.has(k)) return x;
  if (k === "description" && isString(x)) return sanitizeText(x);
  if (NAME_MAP_KEYS.has(k) && isRec(x)) return mapRec(x, (_n, sub) => schemaDesc(sub, depth + 1));
  return isRec(x) || Array.isArray(x) ? schemaDesc(x, depth + 1) : x;
}

// Only schema-position `description` strings change; names, required, type, enum and default stay.
function schemaDesc(v, depth = 0) {
  if (depth > 40) return v;
  if (Array.isArray(v)) {
    const out = v.map((x) => schemaDesc(x, depth + 1));
    return out.some((x, i) => x !== v[i]) ? out : v;
  }
  return isRec(v) ? mapRec(v, (k, x) => schemaKey(k, x, depth)) : v;
}

function systemRoles(list) {
  const out = list.map((x) => {
    if (!isRec(x) || (x.role !== "system" && x.role !== "developer")) return x;
    const c = textBlocks(x.content);
    return c === x.content ? x : { ...x, content: c };
  });
  return out.some((x, i) => x !== list[i]) ? out : list;
}

function kiroTools(cs) {
  const uim = cs?.currentMessage?.userInputMessage;
  if (!isRec(cs) || !isRec(cs.currentMessage) || !isRec(uim)) return cs;
  const ctx = uim.userInputMessageContext;
  if (!isRec(ctx) || !Array.isArray(ctx.tools)) return cs;
  const tools = schemaDesc(ctx.tools);
  if (tools === ctx.tools) return cs;
  return {
    ...cs,
    currentMessage: {
      ...cs.currentMessage,
      userInputMessage: { ...uim, userInputMessageContext: { ...ctx, tools } },
    },
  };
}

function sanitizeOne(body) {
  let out = null;
  const set = (k, v) => {
    if (v !== body[k]) (out ??= { ...body })[k] = v;
  };
  if (Array.isArray(body.messages)) set("messages", systemRoles(body.messages));
  if (Array.isArray(body.input)) set("input", systemRoles(body.input));
  if (body.system !== undefined) set("system", textBlocks(body.system));
  if (isString(body.instructions)) set("instructions", sanitizeText(body.instructions));
  for (const k of ["systemInstruction", "system_instruction"]) {
    const si = body[k];
    if (isRec(si) && Array.isArray(si.parts)) {
      const parts = textBlocks(si.parts);
      if (parts !== si.parts) set(k, { ...si, parts });
    }
  }
  if (Array.isArray(body.tools)) set("tools", schemaDesc(body.tools));
  // Kiro keeps tool specs under conversationState.currentMessage.userInputMessage.userInputMessageContext.tools.
  if (body.conversationState !== undefined) set("conversationState", kiroTools(body.conversationState));
  return out ?? body;
}

/** Opt-in: DURINDOOR_SANITIZE_IDENTITY=1 (or true/on/yes). */
export function isIdentitySanitizerEnabled(env = process.env) {
  const v = String(env?.DURINDOOR_SANITIZE_IDENTITY ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Returns the same object when disabled, on an unknown shape, on any error, or
 * when nothing changed; otherwise a structurally shared copy. Never mutates.
 */
export function sanitizeIdentity(body, env = process.env) {
  try {
    if (!isIdentitySanitizerEnabled(env) || !isRec(body)) return body;
    let r = sanitizeOne(body);
    if (isRec(r.request)) {
      // Antigravity / Cloud Code envelope.
      const inner = sanitizeOne(r.request);
      if (inner !== r.request) r = { ...r, request: inner };
    }
    return r;
  } catch {
    return body;
  }
}
