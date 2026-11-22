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

// PRIVATE KEY blocks are found with one forward pass instead of a lazy regex:
// with N unclosed BEGIN markers the regex rescans up to 20000 characters from
// each one (quadratic, #2238). Every BEGIN sees the same first END, so that END
// is looked up once and reused until the cursor moves past it.
const PRIVATE_KEY_BEGIN_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g;
const PRIVATE_KEY_END_RE = /-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g;
const PRIVATE_KEY_MAX_BODY = 20000;

function maskPrivateKeys(text, counts, replacement) {
  if (!text.includes("-----BEGIN ")) return text;
  let out = "";
  let cursor = 0;
  let end = null; // first END at or after the last search position
  PRIVATE_KEY_BEGIN_RE.lastIndex = 0;
  for (let begin = PRIVATE_KEY_BEGIN_RE.exec(text); begin; begin = PRIVATE_KEY_BEGIN_RE.exec(text)) {
    const bodyStart = begin.index + begin[0].length;
    if (!end || end.index <= bodyStart) {
      PRIVATE_KEY_END_RE.lastIndex = bodyStart + 1;
      end = PRIVATE_KEY_END_RE.exec(text);
      // No END anywhere ahead means no later BEGIN can close either.
      if (!end) break;
    }
    if (end.index - bodyStart > PRIVATE_KEY_MAX_BODY) continue;
    out += text.slice(cursor, begin.index) + replacement;
    cursor = end.index + end[0].length;
    counts.private_key = (counts.private_key ?? 0) + 1;
    PRIVATE_KEY_BEGIN_RE.lastIndex = cursor;
  }
  return cursor ? out + text.slice(cursor) : text;
}

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
{ name: "private_key", scan: maskPrivateKeys, label: "private_key" },
{ name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "jwt" },
{
  name: "connection_string",
  regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:/@\s"']+:[^/@\s"']+@/g,
  label: "connection_string"
},
// Generic OpenAI-compatible `sk-` keys. Must stay last so specific labels win.
{ name: "openai_compatible", regex: /(?<![A-Za-z0-9])sk-[A-Za-z0-9._~+/=-]{20,}/g, label: "openai_compatible" }];

// Secrets pasted from env/config files often have no recognizable provider prefix.
// Keep the label and separator, and require a long value to avoid masking prose.
// Variable and expression references (process.env.X, os.environ[...], $VAR,
// ${VAR}, bare identifiers, calls) and placeholders are never masked: only a
// literal secret is. maskText also runs on responses, so ordinary code must
// come back unchanged.
// `pass`/`pwd` only count as a whole word or a _/- separated suffix (DB_PASS), never inside bypass/compass.
const SECRET_LABEL_NAME = String.raw`(?<![A-Za-z0-9_-])(?:[A-Za-z0-9_-]*(?:password|passwd|secret|secret[_-]?key|secret[_-]?access[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)|(?:[A-Za-z0-9]+[_-])*(?:pass|pwd))["']?\s*[:=]\s*`;
const SECRET_LABEL = String.raw`${SECRET_LABEL_NAME}["']?`;
// Authorization: Bearer <hex or token>, header or JSON/curl form.
const BEARER_LABEL = String.raw`(?<![A-Za-z0-9_-])authorization["']?\s*[:=]\s*["']?bearer\s+`;
const SECRET_VALUE_CHAR = String.raw`[A-Za-z0-9._~+/=!@#$%^*:-]`;
const SECRET_MIN_LENGTH = 12;
const IDENT = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
// process.env.X, env.X, import.meta.env.X, config.apiKey, settings.secrets.db
const MEMBER_EXPRESSION_RE = new RegExp(`^${IDENT}(?:\\.${IDENT})+$`);
// Bare identifier without a digit: a variable name, not a generated secret.
const DIGITLESS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z_$]*$/;
// SCREAMING_SNAKE constant names such as OPENAI_API_KEY or SECRET_V2.
const CONSTANT_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/;
// "example" and "placeholder" only mark a placeholder as the whole value, its
// first word or its last word; a real secret that merely contains them is masked.
const PLACEHOLDER_RE = /^(.)\1+$|redacted|^(?:example|placeholder)|[_-](?:example|placeholder)$|changeme|change[_-]me|replace[_-]?me|dummy|your[_-]|[_-]here$|^<|^\[|^xxx/i;

function isLiteralSecret(value, quoted, nextChar) {
  if (value.length < SECRET_MIN_LENGTH) return false;
  if (PLACEHOLDER_RE.test(value)) return false;
  if (quoted) return true;
  // Call or index expression: os.getenv("X"), os.environ["X"], ENV.fetch(...).
  if (nextChar === "(" || nextChar === "[") return false;
  if (MEMBER_EXPRESSION_RE.test(value)) return false;
  if (DIGITLESS_IDENTIFIER_RE.test(value)) return false;
  if (CONSTANT_NAME_RE.test(value)) return false;
  return true;
}

// Quoted values may hold spaces ("correct horse battery staple"); the unquoted
// rule below stops at the first space and would leave the rest readable.
const QUOTED_SECRET_VALUE_RE = /^[^"'\r\n]*\s[^"'\r\n]*$/;
CREDENTIAL_PATTERNS.splice(CREDENTIAL_PATTERNS.length - 1, 0, {
  name: "labelled_quoted_secret",
  regex: new RegExp(`(${SECRET_LABEL_NAME})(["'])([^"'\\r\\n]{${SECRET_MIN_LENGTH},})\\2`, "gi"),
  label: "secret",
  accept: (_match, _labelled, _quote, value) => QUOTED_SECRET_VALUE_RE.test(value) && !PLACEHOLDER_RE.test(value.trim()),
  replace: (_match, labelled, quote) => `${labelled}${quote}[REDACTED:secret]${quote}`
}, {
  name: "bearer_token",
  regex: new RegExp(`(${BEARER_LABEL})([A-Za-z0-9._~+/=-]{16,})`, "gi"),
  label: "bearer",
  accept: (_match, _labelled, value) => !PLACEHOLDER_RE.test(value),
  replace: (_match, labelled) => `${labelled}[REDACTED:bearer]`
}, {
  name: "labelled_secret",
  regex: new RegExp(`(${SECRET_LABEL})(?![$%])(${SECRET_VALUE_CHAR}{${SECRET_MIN_LENGTH},})`, "gi"),
  label: "secret",
  accept: (_match, labelledPrefix, value, offset, input) =>
    isLiteralSecret(value, /["']$/.test(labelledPrefix), input[offset + _match.length]),
  replace: (_match, labelledPrefix) => `${labelledPrefix}[REDACTED:secret]`
});


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
    if (p.scan) {
      out = p.scan(out, counts, replacement(p));
      continue;
    }
    p.regex.lastIndex = 0;
    out = out.replace(p.regex, (match, ...captures) => {
      if (p.accept && !p.accept(match, ...captures)) return match;
      counts[p.name] = (counts[p.name] ?? 0) + 1;
      if (p.replace) return p.replace(match, ...captures);
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

/** Mask every string leaf of a JSON value (object keys are left alone). */
function maskDeep(value, ctx) {
  if (isString(value)) return maskText(value, ctx.opts, ctx.counts);
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const m = maskDeep(v, ctx);
      if (m !== v) changed = true;
      return m;
    });
    return changed ? next : value;
  }
  if (!value || !isObject(value)) return value;
  let out = value;
  for (const [k, v] of Object.entries(value)) {
    const m = maskDeep(v, ctx);
    if (m !== v) out = out === value ? { ...value, [k]: m } : { ...out, [k]: m };
  }
  return out;
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
    // Claude `document` blocks: only text sources are readable text; base64/url
    // sources are never scanned. `content` sources hold text blocks.
    if (part.type === "document" && isObject(part.source)) {
      const { source } = part;
      let masked = source;
      if (source.type === "text" && isString(source.data)) {
        const t = maskText(source.data, ctx.opts, ctx.counts);
        if (t !== source.data) masked = { ...source, data: t };
      } else if (source.type === "content") {
        const c = maskContent(source.content, ctx);
        if (c !== source.content) masked = { ...source, content: c };
      }
      if (masked !== source) out = { ...out, source: masked };
    }
    // Gemini tool results: the response object is data returned to the model.
    if (isObject(part.functionResponse) && "response" in part.functionResponse) {
      const r = maskDeep(part.functionResponse.response, ctx);
      if (r !== part.functionResponse.response) out = { ...out, functionResponse: { ...part.functionResponse, response: r } };
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
  // Bare text blocks as list items: Claude `system: [{type:"text",text}]`,
  // Responses top-level `input: [{type:"input_text",text}]`.
  if (TEXT_PART_TYPES.has(item.type) && isString(item.text)) {
    const t = maskText(item.text, ctx.opts, ctx.counts);
    if (t !== item.text) out = { ...out, text: t };
  }
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
  // Chat `messages[].name` is free text the provider reads.
  if (isString(item.name) && "role" in item) {
    const n = maskText(item.name, ctx.opts, ctx.counts);
    if (n !== item.name) out = { ...out, name: n };
  }
  return out;
}

/** Chat `tools[].function.description` (and bare `tools[].description`) is prompt text. */
function maskTools(tools, ctx) {
  if (!Array.isArray(tools)) return tools;
  let changed = false;
  const next = tools.map((tool) => {
    if (!tool || !isObject(tool)) return tool;
    let out = tool;
    if (isObject(tool.function) && isString(tool.function.description)) {
      const d = maskText(tool.function.description, ctx.opts, ctx.counts);
      if (d !== tool.function.description) out = { ...out, function: { ...tool.function, description: d } };
    }
    if (isString(tool.description)) {
      const d = maskText(tool.description, ctx.opts, ctx.counts);
      if (d !== tool.description) out = { ...out, description: d };
    }
    if (out !== tool) changed = true;
    return out;
  });
  return changed ? next : tools;
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
/** Case-insensitive mode; null when the value is not a known mode. */
export function normalizeMaskingMode(mode) {
  const m = isString(mode) ? mode.trim().toLowerCase() : "";
  return MASKING_MODES.includes(m) ? m : null;
}

export function maskRequestContent(body, config = {}) {
  const mode = normalizeMaskingMode(config?.mode) ?? "off";
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
  if ("tools" in body) next.tools = maskTools(body.tools, ctx);
  const total = Object.values(ctx.counts).reduce((a, b) => a + b, 0);
  const changed = mode === "mask" && Object.keys(next).some((k) => next[k] !== body[k]);
  return { body: changed ? next : body, counts: ctx.counts, total };
}
