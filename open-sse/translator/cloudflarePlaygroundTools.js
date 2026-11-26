/**
 * Emulated tool calling for the Cloudflare AI Playground, which has no native
 * function calling: OpenAI `tools[]` become a prompt contract, and the model's
 * text reply is read back into `tool_calls`.
 *
 * A call is emitted only for a declared tool with schema-valid arguments. A
 * batch is all or nothing, so a cut-off or partly invalid reply stays text.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT)
 * `open-sse/translator/cloudflarePlaygroundTools.ts`, PR #18313.
 */
import { randomUUID } from "node:crypto";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { matchesToolSchema } from "../utils/toolArgumentSchema.js";
import {
  CF_MAX_MESSAGE_CHARS, CF_MAX_USER_MESSAGES, hasCfToolHistory, fitCfConversation,
} from "./cloudflarePlaygroundConversation.js";

// Two slots stay free for the compacted history and the newest turn.
const MAX_CONTRACT_CHUNKS = CF_MAX_USER_MESSAGES - 2;
const MAX_DESCRIPTION_CHARS = 160;
// Each unmatched opener costs a scan to the end of the reply.
const MAX_UNMATCHED_OPENERS = 50;
// Fail closed on oversized replies or excessive rescanning of malformed JSON.
const MAX_REPLY_CHARS = 1_000_000;
const MAX_SCAN_CHARS = 1_000_000;
const CONTINUED = "# Tool Calling Instructions (continued)\nTools:";
const TAG_BLOCK = /<tool(?:_call)?>\s*([\s\S]*?)\s*<\/tool(?:_call)?>/g;
const TAG_OPENER = /<tool(?:_call)?>/;
// An opener that begins a JSON document: a keyed object or an array of objects.
const STARTS_DOCUMENT = /^(?:\{\s*"|\[\s*\{)/;

function declaredTools(body) {
  const choice = body.tool_choice;
  if (choice === "none" || !Array.isArray(body.tools)) return { tools: [], mustCall: false };
  const forced = choice?.function?.name;
  const tools = body.tools.map((tool) => tool?.function)
    .filter((fn) => isString(fn?.name) && fn.name && (!forced || fn.name === forced));
  return { tools, mustCall: choice === "required" || Boolean(forced) };
}

function typeLabel(schema, depth) {
  if (Array.isArray(schema?.enum)) return schema.enum.map((value) => JSON.stringify(value)).join("|");
  if (schema?.type === "array") return `${typeLabel(schema.items, depth)}[]`;
  if (isRecord(schema?.properties) && depth > 0) return objectSignature(schema, depth - 1);
  return [schema?.type ?? "any"].flat().join("|");
}

function objectSignature(schema, depth) {
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const fields = Object.entries(isRecord(schema?.properties) ? schema.properties : {})
    .map(([key, value]) => `${key}${required.has(key) ? "" : "?"}: ${typeLabel(value, depth)}`);
  return `{${fields.join(", ")}}`;
}

function signature(tool) {
  const summary = String(tool.description || "").trim().split("\n")[0].slice(0, MAX_DESCRIPTION_CHARS);
  return `- ${tool.name}(${objectSignature(tool.parameters, 2)})${summary ? `: ${summary}` : ""}`;
}

function contractHeader(nonce, mustCall) {
  return [
    "# Tool Calling Instructions",
    "To use a tool, reply with raw JSON and nothing else: one object for one call, or an array of objects for several calls.",
    `Template: {"type": "tool_call", "name": "<tool_name>", "arguments": {"<key>": "<value>"}, "_nonce": "${nonce}"}`,
    `"type" is always "tool_call". "name" is the exact tool name from the Tools list. "arguments" uses that tool's argument keys. Copy "_nonce" exactly into every call.`,
    mustCall ? "You must call a tool in your next reply." : "When no tool is needed, answer in plain prose.",
    "",
    "Tools:",
  ].join("\n");
}

/** The contract in playground-sized chunks. Tools past the last chunk are left out. */
function contractChunks(tools, nonce, mustCall) {
  const chunks = [contractHeader(nonce, mustCall)];
  for (const [index, tool] of tools.entries()) {
    const line = signature(tool).slice(0, CF_MAX_MESSAGE_CHARS - CONTINUED.length - 1);
    if (chunks.at(-1).length + line.length + 1 <= CF_MAX_MESSAGE_CHARS) chunks[chunks.length - 1] += `\n${line}`;
    else if (chunks.length < MAX_CONTRACT_CHUNKS) chunks.push(`${CONTINUED}\n${line}`);
    else {
      console.warn(`[Cloudflare Playground] Omitted ${tools.length - index} tools from the tool contract`);
      break;
    }
  }
  return chunks;
}

/**
 * The messages to send, plus the context needed to read calls from the reply.
 * A conversation with no tools and no tool history is returned untouched.
 */
export function prepareCfToolRequest(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const { tools, mustCall } = declaredTools(body);
  if (!tools.length && !hasCfToolHistory(messages)) return { messages, toolContext: null };
  const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
  const contract = tools.length ? contractChunks(tools, nonce, mustCall) : [];
  return {
    messages: fitCfConversation(messages, contract),
    toolContext: tools.length ? { tools, nonce } : null,
  };
}

function parseJson(raw) {
  try { return JSON.parse(raw); } catch { return undefined; }
}

const unfence = (text) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/** The call objects inside one JSON value: itself, an array, or an OpenAI `tool_calls` wrapper. */
function envelopes(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.tool_calls)) return value.tool_calls.map((call) => call?.function ?? call);
  return [value];
}

function declaredTool(name, tools) {
  if (!isString(name)) return null;
  const loose = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = tools.find((tool) => tool.name === name);
  if (exact) return exact;
  const near = tools.filter((tool) => loose(tool.name) === loose(name));
  return near.length === 1 ? near[0] : null;
}

function toCall(envelope, { tools, nonce }) {
  if (!isRecord(envelope) || !Object.hasOwn(envelope, "arguments")) return null;
  if (envelope.type !== undefined && envelope.type !== "tool_call") return null;
  // A different nonce marks a replayed or injected envelope.
  if (envelope._nonce !== undefined && envelope._nonce !== nonce) return null;
  const args = isString(envelope.arguments) ? parseJson(envelope.arguments) : envelope.arguments;
  const tool = declaredTool(envelope.name, tools);
  if (!tool || !isRecord(args) || !matchesToolSchema(tool.parameters, args)) return null;
  return { name: tool.name, arguments: JSON.stringify(args) };
}

function toCalls(values, context) {
  const calls = values.flatMap(envelopes).map((envelope) => toCall(envelope, context));
  return calls.length && calls.every(Boolean) ? calls : null;
}

/** Index just past the bracket that closes the one at `start`, or -1. */
function closingIndex(text, start, budget) {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    if (--budget.remaining < 0) return -1;
    const char = text[i];
    if (quoted) {
      if (char === "\\") i++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * JSON documents embedded in prose. Null when one is cut off or broken: reading
 * the complete calls inside it would run only part of what the model asked for.
 */
function embeddedDocuments(text) {
  if (text.length > MAX_REPLY_CHARS) return null;
  const documents = [];
  const budget = { remaining: MAX_SCAN_CHARS };
  let unmatched = 0;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const end = closingIndex(text, start, budget);
    if (budget.remaining < 0) return null;
    if (end === -1 && ++unmatched > MAX_UNMATCHED_OPENERS) return null;
    const value = end === -1 ? undefined : parseJson(text.slice(start, end));
    if (value !== undefined) {
      documents.push({ start, end, value });
      start = end - 1;
    } else if (STARTS_DOCUMENT.test(text.slice(start, start + 64))) return null;
  }
  return documents;
}

const claimsToBeCall = (envelope) => envelope?._nonce !== undefined || envelope?.type === "tool_call";

function taggedCalls(text, tags, attempts, context) {
  const ranges = tags.map((tag) => ({ start: tag.index, end: tag.index + tag[0].length }));
  const stray = attempts.some((attempt) => !ranges.some((range) => attempt.start >= range.start && attempt.end <= range.end));
  const values = tags.map((tag) => parseJson(unfence(tag[1])));
  const bound = !text.replace(TAG_BLOCK, "").trim() || values.every((value) => envelopes(value).every((envelope) => envelope?._nonce === context.nonce));
  const calls = !stray && bound && toCalls(values, context);
  return calls ? { calls, ranges } : null;
}

/** Calls written beside prose must carry this request's nonce, including tagged calls. */
function proseCalls(text, context) {
  const documents = embeddedDocuments(text);
  if (!documents || TAG_OPENER.test(text.replace(TAG_BLOCK, ""))) return null;
  const attempts = documents.filter((document) => envelopes(document.value).some(claimsToBeCall));
  const tags = [...text.matchAll(TAG_BLOCK)];
  if (tags.length) return taggedCalls(text, tags, attempts, context);
  const bound = attempts.every((document) => envelopes(document.value).every((envelope) => envelope?._nonce === context.nonce));
  const calls = bound && toCalls(attempts.map((document) => document.value), context);
  return calls ? { calls, ranges: attempts } : null;
}

function withoutRanges(text, ranges) {
  const kept = [...ranges].reverse().reduce((out, { start, end }) => out.slice(0, start) + out.slice(end), text);
  return kept.replace(/```(?:json)?\s*```/gi, "").trim();
}

/** `{ content, toolCalls }` for a completed reply. `toolCalls` is null when it stays text. */
export function parseCfToolReply(text, context) {
  const whole = parseJson(unfence(text));
  let found = null;
  if (whole === undefined) found = proseCalls(text, context);
  else {
    const calls = toCalls([whole], context);
    if (calls) found = { calls, ranges: [{ start: 0, end: text.length }] };
  }
  if (!found) return { content: text, toolCalls: null };
  return {
    content: withoutRanges(text, found.ranges),
    toolCalls: found.calls.map((call) => ({
      id: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "function", function: call,
    })),
  };
}
