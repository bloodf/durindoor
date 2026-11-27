// SYNTX prompt framing, tool-call parsing, SSE decode and wire bodies. Port of
// OmniRoute c71f0065 open-sse/executors/syntxChat.ts.
//
// Fork deviations:
//   - the source env switch OMNIROUTE_PROMPT_EMULATE_TOOLS is an executor
//     option (`emulateTools`, default on) instead of a process env read;
//   - extractSyntxSseEvent also reports `done` ([DONE]) so a body that ends
//     without [DONE] or usage_final is a truncation, not a success;
//   - SSE frames are split by the shared open-sse/utils/sseFrames.js reader.
import { createHash, randomBytes } from "node:crypto";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SYNTX_MAX_GENERATE_CHARS, SYNTX_ROLLOVER_LAST_USER_CHARS, SYNTX_ROLLOVER_TOOL_CHARS, SYNTX_ROLLOVER_TRANSCRIPT_CHARS,
  SYNTX_SSE_ORIGIN,
} from "./config.js";
import { extractSyntxMessageText } from "./sessions.js";
import { parseSseFrame } from "../../../utils/sseFrames.js";

const asRecord = (value) => (isRecord(value) ? value : {});
const str = (value) => (isString(value) ? value : "");

export const SYNTX_TOOL_MARK = "<tool_call>";
export const SYNTX_TOOL_INSTRUCTIONS = `
# Tool Calling
SYNTX native tools (search, code, shell) are on.
Local proxy tools are also on.
Call a local proxy tool with EXACTLY this block (no markdown fences):
<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>
Multiple blocks allowed. If no local tool is needed, answer in plain text.
`;

/** Source SYNTX_NATIVE_TOOLS: the string-id tool list of the browser generate body. */
export const SYNTX_NATIVE_TOOLS = Object.freeze(["search", "code", "shell"]);

/** Source SYNTX_FILE_COMPACT_PROMPT. */
export const SYNTX_FILE_COMPACT_PROMPT =
  "Analyze the attached tmp.txt chat transcript in full (do not ask for it to be pasted).\n" +
  "Write a handoff so this same chat can continue the same task.\n" +
  "Maximum 10000 characters.\n" +
  "Keep: user goal, constraints, files/paths, decisions, errors, current state, next step.\n" +
  "Drop: tool catalogs, system instructions, session secrets, duplicated logs, raw file bodies.\n" +
  "Plain text only. No JSON tool calls.";

const toolFn = (tool) => (asRecord(asRecord(tool).function).name ? asRecord(tool.function) : asRecord(tool));

export function listSyntxToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.filter(isRecord).map((tool) => str(toolFn(tool).name)).filter(Boolean);
}

function formatSyntxToolParams(fn) {
  const parameters = asRecord(fn.parameters);
  const entries = Object.entries(asRecord(parameters.properties));
  if (entries.length === 0) return "";
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.filter(isString) : []);
  let out = "Parameters:\n";
  for (const [key, spec] of entries) {
    const info = asRecord(spec);
    const req = required.has(key) ? ", required" : "";
    const desc = isString(info.description) ? ` — ${info.description}` : "";
    out += `  - ${key} (${str(info.type) || "any"}${req})${desc}\n`;
  }
  return out;
}

function formatOneSyntxToolDef(tool) {
  if (!isRecord(tool)) return "";
  const fn = toolFn(tool);
  const name = str(fn.name);
  if (!name) return "";
  let out = `### ${name}\n`;
  if (isString(fn.description) && fn.description) out += `${fn.description}\n`;
  out += formatSyntxToolParams(fn);
  return `${out}\n`;
}

export function formatSyntxToolDefs(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  let out = `${SYNTX_TOOL_INSTRUCTIONS}## Available tools:\n\n`;
  for (const tool of tools) out += formatOneSyntxToolDef(tool);
  return out;
}

export function collectSyntxTopLevelSystem(body) {
  const parts = [];
  const push = (value) => {
    if (isString(value) && value.trim()) parts.push(value.trim());
  };
  const sys = body.system;
  if (isString(sys)) push(sys);
  else if (Array.isArray(sys)) {
    for (const item of sys) {
      if (isString(item)) push(item);
      else if (isRecord(item)) push(extractSyntxMessageText(item.text ?? item.content ?? item));
    }
  }
  push(body.instructions);
  return parts.join("\n\n").trim();
}

/** Source normalizeSyntxRequestMessages: messages or Responses input, plus top-level system/instructions. */
export function normalizeSyntxRequestMessages(body) {
  const raw = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  const top = collectSyntxTopLevelSystem(body);
  const out = [];
  if (top) {
    const sample = top.slice(0, Math.min(80, top.length));
    const already = raw.some((message) => {
      const role = str(message?.role).toLowerCase();
      if (role !== "system" && role !== "developer") return false;
      return Boolean(sample) && extractSyntxMessageText(message.content).includes(sample);
    });
    if (!already) out.push({ role: "system", content: top });
  }
  for (const message of raw) if (isRecord(message)) out.push(message);
  return out;
}

function parseToolCallArgs(raw) {
  if (!isString(raw)) return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function appendAssistantToolCalls(text, toolCalls) {
  if (!Array.isArray(toolCalls)) return text;
  let out = text;
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) continue;
    const fn = asRecord(toolCall.function);
    out += `\n${SYNTX_TOOL_MARK}\n${JSON.stringify({ name: str(fn.name), arguments: parseToolCallArgs(fn.arguments) })}\n</tool_call>`;
  }
  return out;
}

const toolResultName = (rec) => str(rec.name) || str(rec.tool_call_id) || "tool";

function flattenOneSyntxMessage(rec, dropClientSystem) {
  const role = str(rec.role).toLowerCase();
  if (role === "system" || role === "developer") {
    return dropClientSystem ? null : `<system>\n${extractSyntxMessageText(rec.content)}\n</system>`;
  }
  if (role === "user") return `<user>\n${extractSyntxMessageText(rec.content)}\n</user>`;
  if (role === "assistant") return `<assistant>\n${appendAssistantToolCalls(extractSyntxMessageText(rec.content), rec.tool_calls)}\n</assistant>`;
  if (role === "tool" || role === "function") {
    return `<tool_result name="${toolResultName(rec)}">\n${extractSyntxMessageText(rec.content)}\n</tool_result>`;
  }
  return null;
}

export function flattenSyntxMessages(messages, dropClientSystem = false) {
  if (!Array.isArray(messages)) return "";
  return messages.filter(isRecord).map((m) => flattenOneSyntxMessage(m, dropClientSystem)).filter(Boolean).join("\n\n").trim();
}

export function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const rec = messages[i];
    if (isRecord(rec) && String(rec.role || "").toLowerCase() === "user") return extractSyntxMessageText(rec.content);
  }
  return "";
}

export function messagesHaveSyntxToolTraffic(messages) {
  if (!Array.isArray(messages)) return false;
  for (const rec of messages) {
    if (!isRecord(rec)) continue;
    const role = str(rec.role);
    if (role === "tool" || role === "function") return true;
    if (role === "assistant" && Array.isArray(rec.tool_calls) && rec.tool_calls.length > 0) return true;
    if (extractSyntxMessageText(rec.content).includes(SYNTX_TOOL_MARK)) return true;
  }
  return false;
}

export function syntxToolCatalogFingerprint(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  return createHash("sha256").update(formatSyntxToolDefs(tools)).digest("hex");
}

function formatOneToolResultBlock(part) {
  if (!isRecord(part)) return null;
  const type = str(part.type).toLowerCase();
  if (type !== "tool_result" && type !== "function_result") return null;
  const name = str(part.name) || str(part.tool_use_id) || str(part.tool_call_id) || "tool";
  const body = extractSyntxMessageText(part.content) || extractSyntxMessageText(part.output) || str(part.content);
  return `<tool_result name="${name}">\n${body}\n</tool_result>`;
}

function formatSyntxUserToolResult(rec) {
  if (Array.isArray(rec.content)) {
    const blocks = rec.content.map(formatOneToolResultBlock).filter(Boolean);
    if (blocks.length > 0) return blocks.join("\n\n");
  }
  const text = extractSyntxMessageText(rec.content);
  if (text.includes("<tool_result") || text.includes("TOOL_OBSERVATION") || text.startsWith("Application result")) return text.trim();
  return null;
}

export function trailingSyntxToolResults(messages) {
  if (!Array.isArray(messages)) return "";
  const parts = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const rec = messages[i];
    if (!isRecord(rec)) break;
    const role = String(rec.role || "").toLowerCase();
    if (role === "tool" || role === "function") {
      parts.unshift(`<tool_result name="${toolResultName(rec)}">\n${extractSyntxMessageText(rec.content)}\n</tool_result>`);
      continue;
    }
    if (role === "user" || role === "human") {
      const formatted = formatSyntxUserToolResult(rec);
      if (!formatted) break;
      parts.unshift(formatted);
      continue;
    }
    break;
  }
  return parts.join("\n\n").trim();
}

/** Source buildSyntxFollowUpDelta: trailing tool results, else the last user text. */
export function buildSyntxFollowUpDelta(messages) {
  return trailingSyntxToolResults(messages) || lastUserText(messages).trim();
}

/** Source capSyntxGenerateText: head+tail strip to SYNTX's input cap. */
export function capSyntxGenerateText(text, max = SYNTX_MAX_GENERATE_CHARS) {
  const t = isString(text) ? text : "";
  if (t.length <= max) return t;
  const omitted = t.length - max;
  const marker = `\n...[logical strip: ${omitted} chars omitted to fit SYNTX ${max} cap]...\n`;
  const budget = Math.max(16, max - marker.length);
  const head = Math.max(8, Math.floor(budget * 0.55));
  const tail = Math.max(8, budget - head);
  return `${t.slice(0, head).trimEnd()}${marker}${t.slice(-tail).trimStart()}`;
}

function looksLikeSyntxToolDump(text) {
  const t = text || "";
  return t.includes("<tool_result") || t.includes("TOOL_OBSERVATION") || t.includes("[tool result") ||
    t.startsWith("Application result") || t.includes("function_call_output");
}

function capSyntxHandoffPart(text, max = SYNTX_ROLLOVER_TOOL_CHARS) {
  const t = isString(text) ? text : "";
  if (!t || t.length <= max) return t;
  if (!looksLikeSyntxToolDump(t) && max >= SYNTX_ROLLOVER_TOOL_CHARS) return t;
  return capSyntxGenerateText(t, max);
}

function flattenOneRolloverMessage(rec) {
  const role = str(rec.role).toLowerCase();
  if (role === "system" || role === "developer") return null;
  if (role === "user") {
    const body = capSyntxHandoffPart(extractSyntxMessageText(rec.content));
    return body ? `<user>\n${body}\n</user>` : null;
  }
  if (role === "assistant") {
    const body = capSyntxHandoffPart(appendAssistantToolCalls(extractSyntxMessageText(rec.content), rec.tool_calls), SYNTX_ROLLOVER_TOOL_CHARS * 4);
    return body ? `<assistant>\n${body}\n</assistant>` : null;
  }
  if (role === "tool" || role === "function") {
    return `<tool_result name="${toolResultName(rec)}">\n${capSyntxGenerateText(extractSyntxMessageText(rec.content), SYNTX_ROLLOVER_TOOL_CHARS)}\n</tool_result>`;
  }
  return null;
}

export function flattenSyntxMessagesForRollover(messages) {
  if (!Array.isArray(messages)) return "";
  return messages.filter(isRecord).map(flattenOneRolloverMessage).filter(Boolean).join("\n\n").trim();
}

export function buildSyntxThreadRolloverText(messages) {
  const last = capSyntxGenerateText(lastUserText(messages).trim() || "Continue.", SYNTX_ROLLOVER_LAST_USER_CHARS);
  const transcript = capSyntxGenerateText(flattenSyntxMessagesForRollover(messages), SYNTX_ROLLOVER_TRANSCRIPT_CHARS);
  return [
    "Continue from the previous SYNTX thread (approaching the 800-message cap). Same task and constraints.",
    "",
    "--- start of thread ---",
    transcript || "(empty)",
    "--- end of thread ---",
    "",
    "Latest user message:",
    last,
  ].join("\n");
}

const wantsSyntxToolCatalog = (tools, messages) => (Array.isArray(tools) && tools.length > 0) || messagesHaveSyntxToolTraffic(messages);

/** Source buildSyntxGenerateText -> `{ text, injectedCatalog }`. */
export function buildSyntxGenerateText({ messages, tools, reuseChat, toolsAlreadyInjected, emulateTools = true, threadRollover, omitClientSystem }) {
  const injectCatalog = emulateTools && wantsSyntxToolCatalog(tools, messages) && !toolsAlreadyInjected;
  const catalog = injectCatalog ? (Array.isArray(tools) && tools.length > 0 ? formatSyntxToolDefs(tools) : SYNTX_TOOL_INSTRUCTIONS) : "";
  const dropSystem = injectCatalog || omitClientSystem === true;
  const body = threadRollover
    ? buildSyntxThreadRolloverText(messages)
    : reuseChat
      ? buildSyntxFollowUpDelta(messages)
      : flattenSyntxMessages(messages, dropSystem) || lastUserText(messages).trim();
  const merged = catalog ? `${catalog}\n\n${body}`.trim() : body.trim();
  return { text: capSyntxGenerateText(merged), injectedCatalog: Boolean(catalog) };
}

function thinkingEffortEnabled(body) {
  const thinkingObj = asRecord(body.thinking);
  const thinkingType = str(thinkingObj.type).toLowerCase();
  if (thinkingType === "enabled" || thinkingType === "auto") return true;
  const budget = Number(thinkingObj.budget_tokens ?? body.max_thinking_tokens ?? 0);
  if (Number.isFinite(budget) && budget > 0) return true;
  const effort = (str(body.reasoning_effort) || str(asRecord(body.reasoning).effort) || thinkingType).toLowerCase();
  return Boolean(effort) && !["none", "minimal", "disabled", "false"].includes(effort);
}

/** Source wantSyntxThinking. */
export function wantSyntxThinking(body, modelId) {
  if (body.thinking === true) return true;
  if (thinkingEffortEnabled(body)) return true;
  return String(modelId).toLowerCase().includes("thinking");
}

function makeToolCall(name, args) {
  return {
    id: `call_${randomBytes(6).toString("hex")}`,
    type: "function",
    function: { name, arguments: isString(args) ? args : JSON.stringify(args ?? {}) },
  };
}

function toolCallFromUnknown(obj) {
  if (!isRecord(obj)) return null;
  const name = str(obj.name) || str(obj.tool);
  if (!name) return null;
  return makeToolCall(name, obj.arguments ?? obj.args ?? obj.parameters ?? {});
}

/** Source parseSyntxToolCalls: `<tool_call>{json}</tool_call>` blocks -> OpenAI tool_calls. */
export function parseSyntxToolCalls(text) {
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const calls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      let raw = match[1].trim();
      if (raw.startsWith("```")) raw = raw.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
      const call = toolCallFromUnknown(JSON.parse(raw));
      if (call) calls.push(call);
    } catch {
      // malformed blocks are ignored, as in the source
    }
  }
  return { calls, content: text.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/g, "").trim() };
}

export function looksLikeSyntxRefusal(text) {
  if (!text || text.includes(SYNTX_TOOL_MARK)) return false;
  const sample = text.length <= 4000 ? text : `${text.slice(0, 2500)}\n${text.slice(-800)}`;
  const phrase = /don['’]?t have|do not have|no access|cannot |can['’]?t (?:access|execute|run|read)|not able to|unable to|not (?:available|exposed|connected)/i;
  const subject = /tool|file|filesystem|shell|bash|terminal|workspace|repositor/i;
  return phrase.test(sample) && subject.test(sample);
}

function applySyntxSsePayload(result, parsed) {
  const type = str(parsed.type);
  if (type === "content" && isString(parsed.content) && parsed.content) {
    result.delta = (result.delta || "") + parsed.content;
    return;
  }
  if (type === "usage_final") {
    const prompt = isNumber(parsed.tokens_input) ? parsed.tokens_input : 0;
    const completion = isNumber(parsed.tokens_output) ? parsed.tokens_output : 0;
    result.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
    return;
  }
  if (type === "error") result.error = str(parsed.message) || str(parsed.content) || "SYNTX stream error";
}

/**
 * Source extractSyntxSseEvent over one frame parsed by the shared
 * sseFrames.js reader: each `data:` line is its own JSON payload, as in the
 * source; `[DONE]` also sets `done`.
 */
export function applySyntxSseFrame(frame) {
  const result = {};
  for (const line of frame?.dataLines ?? []) {
    const payload = String(line).trim();
    if (payload === "[DONE]") {
      result.done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      if (isRecord(parsed)) applySyntxSsePayload(result, parsed);
    } catch {
      // malformed data lines are ignored, as in the source
    }
  }
  return result;
}

/** Source extractSyntxSseEvent for one raw event block. */
export function extractSyntxSseEvent(event) {
  return applySyntxSseFrame(parseSseFrame(String(event ?? "")));
}

/** Source isSyntxStreamUrl, plus: no credentials, no explicit port, no fragment. */
export function isSyntxStreamUrl(url) {
  if (!isString(url) || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.origin === SYNTX_SSE_ORIGIN && parsed.pathname.startsWith("/stream/") &&
      !parsed.username && !parsed.password && !parsed.port && !parsed.hash && !parsed.pathname.includes("/../");
  } catch {
    return false;
  }
}

/** Source encodeSyntxUploadMultipart: one `files` part plus destination/check_duplicates/model_type. */
export function encodeSyntxUploadMultipart({ bytes, name, mime }) {
  const safeName = String(name || "").replace(/["\r\n]/g, "_") || "image.png";
  const safeMime = String(mime || "").replace(/[\r\n]/g, "") || "application/octet-stream";
  const boundary = `----WebKitFormBoundary${randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeName}"\r\nContent-Type: ${safeMime}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="destination"\r\n\r\nuploaded\r\n--${boundary}\r\nContent-Disposition: form-data; name="check_duplicates"\r\n\r\ntrue\r\n--${boundary}\r\nContent-Disposition: form-data; name="model_type"\r\n\r\n\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function chatTitleFromText(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

/** Source buildSyntxGenerateBody. */
export function buildSyntxGenerateBody({ chatUuid, text, model, thinking, deepResearch, nativeTools, files }) {
  const body = {
    chat_uuid: chatUuid,
    text,
    model,
    thinking: thinking === true,
    plan: false,
    deep_research: deepResearch === true,
    tools: nativeTools === false ? [] : [...SYNTX_NATIVE_TOOLS],
  };
  if (files && files.length > 0) body.files = files;
  return body;
}
