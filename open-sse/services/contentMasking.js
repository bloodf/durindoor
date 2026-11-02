// Opt-in PII / credential masking for outbound request content (#1112).
//
// Patterns ported from OmniRoute (diegosouzapw/OmniRoute@61e07fb7, MIT):
//   open-sse/utils/credentialPatterns.ts  (credential signatures)
//   src/shared/utils/inputSanitizer.ts     (PII_PATTERNS)
//   src/lib/guardrails/piiMasker.ts        (message walk incl. nested tool_result, PR #12930)
// Deviations (all to cut false positives):
//   - Credit cards must pass Luhn; Brazilian phone numbers need "(DD)" so bare
//     10-11 digit ids/timestamps are not phones.
//   - PII is never matched inside fenced or inline code; credentials are (a
//     secret pasted in code is still a secret).
//   - data: URLs and non-text parts (images, documents, tool calls) are never
//     scanned, so base64 payloads, tool ids, call ids and tool arguments stay
//     byte-identical.
//
// Modes: "off" (default, nothing scanned), "warn" (count only, body returned
// by reference), "mask" (rewritten copy; caller body never mutated). Results
// carry per-type counts only, never the matched text.

import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const MASKING_MODES = ["off", "warn", "mask"];

const CREDENTIAL_PATTERNS = [
{ name: "openai_proj", regex: /sk-proj-[A-Za-z0-9_-]{20,}/g, label: "openai" },
{ name: "anthropic", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, label: "anthropic" },
{ name: "groq", regex: /\bgsk_[A-Za-z0-9]{20,}/g, label: "groq" },
{ name: "xai", regex: /\bxai-[A-Za-z0-9]{20,}/g, label: "xai" },
{ name: "google", regex: /AIza[0-9A-Za-z_-]{20,}/g, label: "google" },
{ name: "huggingface", regex: /\bhf_[A-Za-z0-9]{34}\b/g, label: "hf" },
{ name: "github", regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})/g, label: "github" },
{ name: "slack", regex: /\bxox[bpoa]-[A-Za-z0-9-]{10,}/g, label: "slack" },
{ name: "stripe", regex: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}/g, label: "stripe" },
{ name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g, label: "aws" },
{ name: "npm", regex: /\bnpm_[A-Za-z0-9]{36}\b/g, label: "npm" },
{
  name: "private_key",
  regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{1,20000}?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  label: "private_key"
},
{ name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "jwt" },
{
  name: "connection_string",
  regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:/@\s"']+:[^:/@\s"']+@/g,
  label: "connection_string"
},
// Generic OpenAI-compatible `sk-` keys. Must stay last so specific labels win.
{ name: "openai_compatible", regex: /(?<![A-Za-z0-9])sk-[A-Za-z0-9._~+/=-]{20,}/g, label: "openai_compatible" }];


function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const PII_PATTERNS = [
{ name: "email", regex: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/g, label: "EMAIL" },
{ name: "cpf", regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, label: "CPF" },
{ name: "cnpj", regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, label: "CNPJ" },
{
  name: "credit_card",
  regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
  label: "CARD",
  accept: (m) => luhn(m.replace(/\D/g, ""))
},
{ name: "phone_br", regex: /\(\d{2}\)\s?\d{4,5}-?\d{4}\b/g, label: "PHONE" },
{ name: "ssn_us", regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: "SSN" }];


const CODE_SPAN_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

// Always substitutes into the working copy so a later, broader pattern never
// re-counts a span an earlier one already claimed; warn mode discards the copy.
function applyPatterns(text, patterns, counts, replacement) {
  let out = text;
  for (const p of patterns) {
    p.regex.lastIndex = 0;
    out = out.replace(p.regex, (match) => {
      if (p.accept && !p.accept(match)) return match;
      counts[p.name] = (counts[p.name] ?? 0) + 1;
      return replacement(p);
    });
  }
  return out;
}

/** Mask one text leaf. PII outside code spans only; credentials everywhere. */
export function maskText(text, { credentials = true, pii = true, replace = true } = {}, counts = {}) {
  if (!isString(text) || !text || text.startsWith("data:")) return text;
  let out = text;
  if (credentials) out = applyPatterns(out, CREDENTIAL_PATTERNS, counts, (p) => `[REDACTED:${p.label}]`);
  if (pii) {
    let cursor = 0;
    let rebuilt = "";
    CODE_SPAN_RE.lastIndex = 0;
    for (const m of out.matchAll(CODE_SPAN_RE)) {
      rebuilt += applyPatterns(out.slice(cursor, m.index), PII_PATTERNS, counts, (p) => `[${p.label}_REDACTED]`) + m[0];
      cursor = m.index + m[0].length;
    }
    out = rebuilt + applyPatterns(out.slice(cursor), PII_PATTERNS, counts, (p) => `[${p.label}_REDACTED]`);
  }
  return replace ? out : text;
}

const TEXT_PART_TYPES = new Set([undefined, "text", "input_text", "output_text"]);
const TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);

/** Walk a message `content` value: strings, text parts, nested tool_result content. */
function maskContent(value, ctx) {
  if (isString(value)) return maskText(value, ctx.opts, ctx.counts);
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next = value.map((part) => {
    if (isString(part)) {
      const t = maskText(part, ctx.opts, ctx.counts);
      if (t !== part) changed = true;
      return t;
    }
    if (!part || !isObject(part)) return part;
    let out = part;
    if (TEXT_PART_TYPES.has(part.type) && isString(part.text)) {
      const t = maskText(part.text, ctx.opts, ctx.counts);
      if (t !== part.text) out = { ...out, text: t };
    }
    if (part.type === "tool_result" && "content" in part) {
      const c = maskContent(part.content, ctx);
      if (c !== part.content) out = { ...out, content: c };
    }
    if (out !== part) changed = true;
    return out;
  });
  return changed ? next : value;
}

function maskItem(item, ctx) {
  if (isString(item)) return maskText(item, ctx.opts, ctx.counts);
  if (!item || !isObject(item)) return item;
  let out = item;
  if ("content" in item) {
    const c = maskContent(item.content, ctx);
    if (c !== item.content) out = { ...out, content: c };
  }
  if (Array.isArray(item.parts)) { // Gemini contents[] / systemInstruction
    const parts = maskContent(item.parts, ctx);
    if (parts !== item.parts) out = { ...out, parts };
  }
  if (TOOL_OUTPUT_TYPES.has(item.type) && "output" in item) {
    const o = maskContent(item.output, ctx);
    if (o !== item.output) out = { ...out, output: o };
  }
  return out;
}

function maskList(list, ctx) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map((item) => {
    const m = maskItem(item, ctx);
    if (m !== item) changed = true;
    return m;
  });
  return changed ? next : list;
}

/**
 * @param {object} body request body (any source format)
 * @param {{mode?: string, credentials?: boolean, pii?: boolean}} [config]
 * @returns {{body: object, counts: Record<string, number>, total: number}}
 */
export function maskRequestContent(body, config = {}) {
  const mode = MASKING_MODES.includes(config?.mode) ? config.mode : "off";
  if (mode === "off" || !body || !isObject(body)) return { body, counts: {}, total: 0 };
  const ctx = {
    counts: {},
    opts: { credentials: config.credentials !== false, pii: config.pii !== false, replace: mode === "mask" }
  };
  const next = { ...body };
  for (const key of ["messages", "input", "system", "prompt", "instructions", "contents", "systemInstruction"]) {
    if (!(key in body)) continue;
    next[key] = Array.isArray(body[key]) ? maskList(body[key], ctx) : maskItem(body[key], ctx);
  }
  const total = Object.values(ctx.counts).reduce((a, b) => a + b, 0);
  const changed = mode === "mask" && Object.keys(next).some((k) => next[k] !== body[k]);
  return { body: changed ? next : body, counts: ctx.counts, total };
}
