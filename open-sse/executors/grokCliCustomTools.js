import { MAX_PENDING_SSE_LINE_BYTES } from "../utils/pendingSseLine.js";
import { isRecord, isString, isNumber } from "../../src/shared/utils/typeChecks.js";

// Grok CLI uses the Responses wire format directly, so top-level freeform tools
// need a local function envelope and response restoration. OmniRoute #14738.
// The stream transform retains response ownership and propagates cancellation.
function nonEmptyName(value) {
  return isString(value) && value.trim() !== "" ? value : null;
}
function customToolKey(namespace, name) {
  const ns = nonEmptyName(namespace);
  return ns ? `${ns}\0${name}` : name;
}
function toFunctionTool(tool, name) {
  const fn = { type: "function", name };
  if (tool.description !== undefined) fn.description = tool.description;
  fn.parameters = {
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
    additionalProperties: false
  };
  if (tool.strict !== undefined) fn.strict = tool.strict;
  return fn;
}
// Grok's own server-side X search calls replay as-is (upstream decolua/9router#2647).
function isNativeXSearchCall(item) {
  return item.type === "custom_tool_call" && isString(item.id) && item.id.startsWith("ctc_") &&
    isString(item.call_id) && item.call_id.startsWith("xs_call-");
}
function convertHistoryItem(item) {
  if (!isRecord(item) || isNativeXSearchCall(item)) return item;
  if (item.type === "custom_tool_call") {
    const { id: _id, type: _type, input, ...rest } = item;
    return { type: "function_call", ...rest, arguments: JSON.stringify({ input: input ?? "" }) };
  }
  if (item.type === "custom_tool_call_output") {
    const { id: _id, type: _type, ...rest } = item;
    return { type: "function_call_output", ...rest };
  }
  return item;
}
function convertGrokBuildCustomTools(body) {
  if (!isRecord(body)) return { body, customTools: null };
  const customTools = new Map();
  const tools = Array.isArray(body.tools) ? body.tools.map((tool) => {
    if (!isRecord(tool) || tool.type !== "custom") return tool;
    const name = nonEmptyName(tool.name);
    if (!name) return tool;
    customTools.set(name, { ...tool });
    return toFunctionTool(tool, name);
  }) : body.tools;
  const input = Array.isArray(body.input) ? body.input.map(convertHistoryItem) : body.input;
  const changed = customTools.size > 0 || Array.isArray(input) && input.some((item, i) => item !== body.input[i]);
  return changed ? { body: { ...body, tools, input }, customTools: customTools.size ? customTools : null } : { body, customTools: null };
}
function isCustomToolCall(item, customTools) {
  return isRecord(item) && item.type === "function_call" && isString(item.name) && customTools.has(customToolKey(item.namespace, item.name));
}
function rawCustomInput(args) {
  if (args === undefined || args === null) return "";
  if (isRecord(args)) return isString(args.input) ? args.input : JSON.stringify(args);
  if (!isString(args)) return String(args);
  try {
    const parsed = JSON.parse(args);
    if (isRecord(parsed) && isString(parsed.input)) return parsed.input;
  } catch {
  }
  return args;
}
function toCustomToolCall(item) {
  const { arguments: args, ...rest } = item;
  return { ...rest, type: "custom_tool_call", input: rawCustomInput(args) };
}
function restoreOutputList(output, customTools) {
  if (!Array.isArray(output)) return false;
  let changed = false;
  output.forEach((item, index) => {
    if (!isCustomToolCall(item, customTools)) return;
    output[index] = toCustomToolCall(item);
    changed = true;
  });
  return changed;
}
function restoreToolList(tools, customTools) {
  if (!Array.isArray(tools)) return false;
  let changed = false;
  tools.forEach((tool, index) => {
    if (!isRecord(tool) || tool.type !== "function" || !isString(tool.name)) return;
    const original = customTools.get(tool.name);
    if (!original) return;
    tools[index] = original;
    changed = true;
  });
  return changed;
}
function restorePayload(payload, customTools) {
  let changed = false;
  if (isCustomToolCall(payload.item, customTools)) {
    payload.item = toCustomToolCall(payload.item);
    changed = true;
  }
  changed = restoreOutputList(payload.output, customTools) || changed;
  changed = restoreToolList(payload.tools, customTools) || changed;
  if (isRecord(payload.response)) {
    changed = restoreOutputList(payload.response.output, customTools) || changed;
    changed = restoreToolList(payload.response.tools, customTools) || changed;
  }
  return changed;
}
const JSON_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
const INPUT_PREFIX = ["{", '"input"', ":", '"'];
function createInputDecoder() {
  let mode = "prefix";
  let token = 0;
  let tokenChar = 0;
  let escape = "";
  let highSurrogate = "";
  const emitUnit = (decoded, code) => {
    if (code >= 55296 && code <= 56319) {
      highSurrogate = decoded;
      return "";
    }
    const out = highSurrogate + decoded;
    highSurrogate = "";
    return out;
  };
  const decodeEscapeChar = (ch) => {
    escape += ch;
    if (escape[1] === "u") {
      if (escape.length < 6) return "";
      const code = Number.parseInt(escape.slice(2), 16);
      escape = "";
      if (Number.isNaN(code)) {
        mode = "raw";
        return "";
      }
      return emitUnit(String.fromCharCode(code), code);
    }
    const decoded = JSON_ESCAPES[escape[1]];
    escape = "";
    if (decoded === undefined) {
      mode = "raw";
      return "";
    }
    return decoded;
  };
  const decodeStringChar = (ch) => {
    if (escape) return decodeEscapeChar(ch);
    if (ch === "\\") {
      escape = ch;
      return "";
    }
    if (ch === '"') {
      mode = "after";
      return highSurrogate;
    }
    const out = highSurrogate + ch;
    highSurrogate = "";
    return out;
  };
  const consumePrefixChar = (ch) => {
    const expected = INPUT_PREFIX[token];
    if (tokenChar === 0 && /\s/.test(ch)) return true;
    if (ch !== expected[tokenChar]) {
      mode = "raw";
      return false;
    }
    tokenChar++;
    if (tokenChar === expected.length) {
      token++;
      tokenChar = 0;
      if (token === INPUT_PREFIX.length) mode = "string";
    }
    return true;
  };
  return {
    get failed() {
      return mode === "raw";
    },
    push(chunk) {
      let out = "";
      for (const ch of chunk) {
        if (mode === "string") out += decodeStringChar(ch);
        else if (mode !== "prefix" || !consumePrefixChar(ch)) break;
      }
      return mode === "raw" ? "" : out;
    }
  };
}
const SSE_BLOCK_SEP_RE = /\r?\n\r?\n/;
const SSE_DATA_LINE_RE = /^data:[ \t]?([^\r\n]*)$/m;
const SSE_EVENT_LINE_RE = /^event:[ \t]?.*$/m;
const SSE_TRAILING_SEP_RE = /(?:\r?\n)+$/;
const SSE_COMMENT_BLOCK = ":\n\n";
function renderBlock(block, payload) {
  const data = JSON.stringify(payload);
  let rendered = block.replace(SSE_TRAILING_SEP_RE, "").replace(SSE_DATA_LINE_RE, () => `data: ${data}`);
  if (isString(payload.type)) {
    rendered = rendered.replace(SSE_EVENT_LINE_RE, () => `event: ${payload.type}`);
  }
  return `${rendered}

`;
}
function callIds(call) {
  const ids = {};
  if (call.itemId !== null) ids.item_id = call.itemId;
  if (call.outputIndex !== null) ids.output_index = call.outputIndex;
  return ids;
}
function findCall(calls, payload) {
  const id = isString(payload.item_id) ? payload.item_id : isString(payload.item?.id) ? payload.item.id : null;
  if (id !== null) {
    const exact = calls.find((call) => call.itemId === id);
    if (exact) return exact;
  }
  if (!isNumber(payload.output_index)) return null;
  return calls.find((call) => call.outputIndex === payload.output_index &&
    (id === null || call.itemId === null || call.itemId === id));
}
function finishCall(block, call, args, doneSeq, metadata = {}) {
  call.done = true;
  const input = rawCustomInput(isString(args) && args !== "" ? args : call.args);
  const ids = callIds(call);
  let out = "";
  const rest = input.startsWith(call.emitted) ? input.slice(call.emitted.length) : "";
  call.args = "";
  call.emitted = "";
  call.decoder = null;
  if (rest) {
    out += renderBlock(block, {
      type: "response.custom_tool_call_input.delta",
      ...ids,
      delta: rest
    });
  }
  const { arguments: _arguments, item: _item, ...fields } = metadata;
  const done = { ...fields, type: "response.custom_tool_call_input.done", ...ids, input };
  if (isNumber(doneSeq)) done.sequence_number = doneSeq;
  return out + renderBlock(block, done);
}
function parseBlockPayload(block) {
  const match = SSE_DATA_LINE_RE.exec(block);
  if (!match || !match[1] || match[1] === "[DONE]") return null;
  try {
    const payload = JSON.parse(match[1]);
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}
function trackAddedCall(calls, payload) {
  calls.push({
    itemId: isString(payload.item.id) ? payload.item.id : null,
    outputIndex: isNumber(payload.output_index) ? payload.output_index : null,
    decoder: createInputDecoder(),
    args: "",
    emitted: "",
    done: false
  });
}
function rewriteArgumentsDelta(block, call, payload) {
  const chunk = isString(payload.delta) ? payload.delta : "";
  if (call.args.length + chunk.length > MAX_PENDING_SSE_LINE_BYTES) throw new Error("Grok CLI custom tool arguments exceed SSE limit");
  call.args += chunk;
  const text = call.decoder.push(chunk);
  if (!text || call.decoder.failed) {
    return SSE_COMMENT_BLOCK;
  }
  call.emitted += text;
  const delta = { ...payload, type: "response.custom_tool_call_input.delta", ...callIds(call), delta: text };
  if (payload.sequence_number !== undefined) delta.sequence_number = payload.sequence_number;
  return renderBlock(block, delta);
}
function createSseBlockRewriter(customTools) {
  const calls = [];
  return (block) => {
    const payload = parseBlockPayload(block);
    if (!payload) return block;
    const isCustomItem = isCustomToolCall(payload.item, customTools);
    if (payload.type === "response.output_item.added" && isCustomItem) {
      trackAddedCall(calls, payload);
    }
    if (payload.type === "response.function_call_arguments.delta") {
      const call = findCall(calls, payload);
      if (call) return call.done ? SSE_COMMENT_BLOCK : rewriteArgumentsDelta(block, call, payload);
    }
    if (payload.type === "response.function_call_arguments.done") {
      const call = findCall(calls, payload);
      if (call) return call.done ? SSE_COMMENT_BLOCK : finishCall(block, call, payload.arguments, payload.sequence_number, payload);
    }
    let prefix = "";
    if (payload.type === "response.output_item.done" && isCustomItem) {
      const call = findCall(calls, payload);
      const item = payload.item;
      if (call && !call.done) prefix = finishCall(block, call, item.arguments, undefined);
    }
    return restorePayload(payload, customTools) ? prefix + renderBlock(block, payload) : prefix + block;
  };
}
async function restoreGrokBuildCustomToolCalls(response, customTools) {
  if (!response.ok || !response.body || customTools.size === 0) return response;
  const contentType = response.headers.get("content-type") || "";
  const init = { status: response.status, statusText: response.statusText };
  if (contentType.includes("text/event-stream")) {
    const rewrite = createSseBlockRewriter(customTools);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    const transform = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const separator = SSE_BLOCK_SEP_RE.exec(buffer);
          if (!separator) break;
          const blockEnd = separator.index + separator[0].length;
          if (blockEnd > MAX_PENDING_SSE_LINE_BYTES) throw new Error("Grok CLI SSE event exceeds limit");
          const block = rewrite(buffer.slice(0, blockEnd));
          buffer = buffer.slice(blockEnd);
          if (block) controller.enqueue(encoder.encode(block));
        }
        if (buffer.length > MAX_PENDING_SSE_LINE_BYTES) throw new Error("Grok CLI SSE event exceeds limit");
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.length > MAX_PENDING_SSE_LINE_BYTES) throw new Error("Grok CLI SSE event exceeds limit");
        const block = buffer ? rewrite(buffer) : "";
        if (block) controller.enqueue(encoder.encode(block));
      }
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(response.body.pipeThrough(transform), { ...init, headers });
  }
  if (contentType.includes("application/json")) {
    const text = await response.text();
    let body = text;
    try {
      const parsed = JSON.parse(text);
      if (isRecord(parsed) && restorePayload(parsed, customTools)) body = JSON.stringify(parsed);
    } catch {
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(body, { ...init, headers });
  }
  return response;
}
export {
  convertGrokBuildCustomTools,
  restoreGrokBuildCustomToolCalls
};
