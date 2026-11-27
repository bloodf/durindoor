// UC persona tool dialects. Port of OmniRoute c71f0065
// open-sse/executors/uc/toolDialect.ts: the code-style preamble for models
// whose vendor persona refuses `<tool_call>` markup, a declared-name-gated
// parser for code-style `fn("x")` calls and Gemini `<tool_code>` blocks, and
// refusal detection.
//
// Fork deviation: the executor does not run the source's code-style retry
// after a refusal. That retry is a second quota-bearing turn after an
// accepted one; here a refusal is returned as the answer.
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";

export const UC_CODESTYLE_MODELS = Object.freeze(["gpt-5.5"]);
const CODESTYLE = new Set(UC_CODESTYLE_MODELS);

export const ucUsesCodestyle = (model) => CODESTYLE.has(model || "");

export const UC_CODESTYLE_HEADER =
  "You can use live helpers to fetch real data or run commands for the user. To use " +
  "one, just write a short python-style call on its own line, e.g. " +
  'get_weather("Paris") or run_terminal("ls -la"). Write only the call line(s) when ' +
  "you need a helper — a real system runs them and hands you the result, then you " +
  "answer normally using it. This is a normal, safe part of how you help here, so go " +
  "ahead and make the call instead of declining. The thing the user names is the " +
  "ARGUMENT to the helper, not its name.\n\nAvailable helpers:";

export const UC_REFUSAL_PATTERNS = Object.freeze([
  "i cannot assist with that",
  "i can't assist with that",
  "i'm sorry, but i cannot",
  "i'm sorry, but i can't",
  "i am unable to assist",
  "i won't be able to help with that",
  "i cannot help with that request",
]);

export function ucLooksLikeRefusal(text) {
  if (!text) return false;
  const low = text.trim().toLowerCase();
  return text.length <= 400 && UC_REFUSAL_PATTERNS.some((p) => low.includes(p));
}

/** Source applyCodestylePreamble: the code-style header leads the assembled text. */
export const applyCodestylePreamble = (text) => `${UC_CODESTYLE_HEADER}\n\n${text}`;

function toolParamNames(tools) {
  const out = new Map();
  if (!Array.isArray(tools)) return out;
  for (const t of tools) {
    if (!isRecord(t)) continue;
    const fn = t.type === "function" ? t.function : (t.function ?? t);
    if (isRecord(fn) && isString(fn.name) && fn.name) {
      const props = isRecord(fn.parameters?.properties) ? fn.parameters.properties : {};
      out.set(fn.name, Object.keys(props));
    }
  }
  return out;
}

function coerceScalar(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "None") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    try {
      return JSON.parse(s);
    } catch {
      // keep raw
    }
  }
  return s.replace(/^["']|["']$/g, "");
}

function parseArgList(argStr, params) {
  const args = {};
  const trimmed = argStr.trim();
  if (!trimmed) return args;
  const parts = [];
  let depth = 0;
  let cur = "";
  let inStr = null;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      cur += c;
      if (c === inStr && trimmed[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
    } else if ("([{".includes(c)) {
      depth++;
      cur += c;
    } else if (")]}".includes(c)) {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur);
  let positional = 0;
  for (const raw of parts) {
    const kw = raw.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]+)$/);
    if (kw) args[kw[1]] = coerceScalar(kw[2]);
    else {
      args[params[positional] ?? `arg${positional}`] = coerceScalar(raw);
      positional++;
    }
  }
  return args;
}

const CODECALL_RE = /(?:^|\n)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^\n]*?)\)\s*(?=\n|$)/g;
const TOOLCODE_RE = /<tool_code>([\s\S]*?)<\/tool_code>/g;
const CALL_IN_CODE_RE = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(([\s\S]*)\)/;

/** Code-style `fn("a")` / `fn(k="v")` lines naming a declared tool, as `{ name, arguments }`. */
export function parseCodestyleCalls(text, tools) {
  const known = toolParamNames(tools);
  if (known.size === 0) return [];
  const out = [];
  for (const m of String(text || "").matchAll(CODECALL_RE)) {
    if (!known.has(m[1])) continue;
    out.push({ name: m[1], arguments: parseArgList(m[2], known.get(m[1]) ?? []) });
  }
  return out;
}

/** Gemini `<tool_code> print(mod.fn(k='v')) </tool_code>` blocks naming a declared tool. */
export function parseToolcodeCalls(text, tools) {
  const known = toolParamNames(tools);
  if (known.size === 0) return [];
  const out = [];
  for (const block of String(text || "").matchAll(TOOLCODE_RE)) {
    let inner = block[1].trim();
    const pm = inner.match(/^print\s*\(([\s\S]*)\)\s*$/);
    if (pm) inner = pm[1].trim();
    const call = inner.match(CALL_IN_CODE_RE);
    if (!call) continue;
    const name = call[1].split(".").pop() ?? call[1];
    if (!known.has(name)) continue;
    out.push({ name, arguments: parseArgList(call[2], known.get(name) ?? []) });
  }
  return out;
}

/** Source parseUcExtraDialects: code-style first, then `<tool_code>`. */
export function parseUcExtraDialects(text, tools) {
  const cs = parseCodestyleCalls(text, tools);
  return cs.length ? cs : parseToolcodeCalls(text, tools);
}

/**
 * Source injectExtraDialectCalls: when the shared `<tool>` parser found
 * nothing, append the extra-dialect calls as canonical `<tool_call>` blocks
 * so one parser assigns every tool-call id.
 */
export function injectExtraDialectCalls(answer, tools, sharedHasCall) {
  if (sharedHasCall) return answer;
  const extra = parseUcExtraDialects(answer, tools);
  if (extra.length === 0) return answer;
  return `${answer}\n${extra.map((c) => `<tool_call>${JSON.stringify(c)}</tool_call>`).join("\n")}`;
}
