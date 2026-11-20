import { isString } from "../../src/shared/utils/typeChecks.js";

// DSML is response data; this module never executes a tool.
export const MAX_DSML_FRAME = 65536;
const delim = String.raw`[|｜]{1,2}\s*DSML\s*[|｜]{1,2}`;
const invoke = new RegExp(String.raw`^<\s*${delim}\s*invoke\s+name=["']([^"']+)["']\s*>`);
const endInvoke = new RegExp(String.raw`<\s*/?\s*${delim}\s*invoke\s*>`);
const wrapper = new RegExp(String.raw`^<\s*${delim}\s*calls\s*>`);
const endWrapper = new RegExp(String.raw`<\s*/?\s*${delim}\s*calls\s*>`);
const parameter = new RegExp(String.raw`^\s*<\s*${delim}\s*parameter\s+name=["']([^"']+)["'](?:\s+string=["'](true|false)["'])?\s*>([\s\S]*?)<\s*/?\s*${delim}\s*parameter\s*>`, "i");
export function isDeepSeekFamilyModel(model, provider) {
  return provider === "deepseek" || provider === "ds" || isString(model) && /deepseek|(?:^|\/)d[f]?model$/i.test(model);
}
function parseInvoke(frame) {
  const start = invoke.exec(frame);
  if (!start) return null;
  const end = endInvoke.exec(frame.slice(start[0].length));
  if (!end || start[0].length + end.index + end[0].length !== frame.length) return null;
  let body = frame.slice(start[0].length, start[0].length + end.index);
  const args = Object.create(null);
  while (body.trim()) {
    const match = parameter.exec(body);
    if (!match || Object.hasOwn(args, match[1])) return null;
    let value = match[3];
    if (match[2]?.toLowerCase() !== "true") {
      try { value = JSON.parse(value); } catch { return null; }
    }
    args[match[1]] = value;
    body = body.slice(match[0].length);
  }
  return { name: start[1], arguments: args };
}
function parseFrame(frame) {
  const start = wrapper.exec(frame);
  if (!start) { const call = parseInvoke(frame); return call ? [call] : null; }
  const end = endWrapper.exec(frame.slice(start[0].length));
  if (!end || start[0].length + end.index + end[0].length !== frame.length) return null;
  let body = frame.slice(start[0].length, start[0].length + end.index);
  const calls = [];
  while (body.trim()) {
    body = body.trimStart();
    const close = endInvoke.exec(body);
    if (!close) return null;
    const call = parseInvoke(body.slice(0, close.index + close[0].length));
    if (!call) return null;
    calls.push(call);
    body = body.slice(close.index + close[0].length);
  }
  return calls.length ? calls : null;
}
/** Retain at most one bounded frame; release malformed frames unchanged. */
export function createDsmlStreamState() {
  let buffer = "", bypass = false, total = 0;
  function drain(final) {
    let text = "";
    const toolCalls = [];
    while (buffer) {
      const at = buffer.indexOf("<");
      if (at < 0) { text += buffer; buffer = ""; break; }
      text += buffer.slice(0, at);
      buffer = buffer.slice(at);
      const start = wrapper.exec(buffer) || invoke.exec(buffer);
      const end = start && (wrapper.test(start[0]) ? endWrapper : endInvoke).exec(buffer.slice(start[0].length));
      if (end && start[0].length + end.index + end[0].length <= MAX_DSML_FRAME) {
        const length = start[0].length + end.index + end[0].length;
        const frame = buffer.slice(0, length), calls = parseFrame(frame);
        if (calls) toolCalls.push(...calls); else text += frame;
        buffer = buffer.slice(length);
      } else if (!start && buffer.indexOf("<", 1) !== -1) {
        const next = buffer.indexOf("<", 1);
        text += buffer.slice(0, next);
        buffer = buffer.slice(next);
      } else if (final || buffer.length > MAX_DSML_FRAME) {
        text += buffer; buffer = "";
        if (!final) bypass = true;
      } else break;
    }
    return { text, toolCalls };
  }
  return { push(value) {
    if (bypass) return { text: value, toolCalls: [] };
    total += value.length;
    if (total > MAX_DSML_FRAME) {
      const text = buffer + value;
      buffer = "";
      bypass = true;
      return { text, toolCalls: [] };
    }
    buffer += value;
    return drain(false);
  }, flush() { return drain(true); } };
}
export function parseDsmlToolCalls(text) {
  if (!isString(text)) return { content: text, toolCalls: [] };
  const stream = createDsmlStreamState(), first = stream.push(text), last = stream.flush();
  return { content: first.text + last.text, toolCalls: [...first.toolCalls, ...last.toolCalls] };
}
