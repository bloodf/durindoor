/**
 * Single-generation fenced tool calls for Microsoft 365 Copilot.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Protocol/tools.ts`,
 * `parseFencedToolCalls`/`clientPlugins` in `copilot-m365-frames.ts` and `open-sse/utils/toolArgumentSchema.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * Tools are prompt-emulated, not native Microsoft function calls: the prompt declares the tools, the
 * model answers with a fenced block per call (the info string is the exact tool name, the body a JSON
 * object of arguments), and only declared tools with schema-valid arguments come back as `tool_calls`.
 */
import { isRecord, isString, runtimeTypeName } from "../../src/shared/utils/typeChecks.js";

export const M365_MAX_TEXT_LENGTH = 1_000_000;

const FENCE = /```([A-Za-z0-9_-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```/g;
const SHELL_ALIASES = new Set(["bash", "sh", "shell", "zsh", "powershell", "pwsh", "ps1", "cmd", "bat"]);
const record = (value) => isRecord(value) ? value : {};

/** A client-declared tool, normalized from an OpenAI `tools[]` entry. */
export function extractToolSpec(body) {
  const raw = Array.isArray(body?.tools) ? body.tools : [];
  const tools = [];
  for (const t of raw) {
    if (t?.type !== "function") continue;
    const fn = record(t.function);
    const name = isString(fn.name) ? fn.name : "";
    if (!name) continue;
    tools.push({
      name,
      description: isString(fn.description) ? fn.description : "",
      parameters: isRecord(fn.parameters) ? fn.parameters : null
    });
  }
  return { tools, toolChoice: body?.tool_choice ?? null };
}

/** Map normalized tools to the `plugins[]` entries of the chat invocation. */
export function clientPlugins(tools) {
  return tools.map((t) => ({ Id: t.name, Source: "API", Description: t.description, Parameters: t.parameters ?? {} }));
}

// ── Argument schema: the interpreted subset (type/integer, enum, object required/properties/
// additionalProperties:false, homogeneous items). Not full JSON Schema; unions and formats stay permissive.
const typeOf = (value) => Array.isArray(value) ? "array" : value === null ? "null" : runtimeTypeName(value);

function validateSchema(value, schema, path) {
  const errors = [];
  if (isString(schema.type)) {
    if (schema.type === "integer") {
      if (!Number.isInteger(value)) errors.push(`${path} must be integer`);
    } else if (typeOf(value) !== schema.type) {
      errors.push(`${path} must be ${schema.type}, got ${typeOf(value)}`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  if (schema.type === "object" || isRecord(value)) {
    const obj = record(value);
    const properties = record(schema.properties);
    for (const key of Array.isArray(schema.required) ? schema.required.map(String) : []) {
      if (!Object.hasOwn(obj, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.hasOwn(obj, key)) errors.push(...validateSchema(obj[key], record(propSchema), `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validateSchema(item, record(schema.items), `${path}[${index}]`)));
  }
  return errors;
}

const validArguments = (tool, args) => validateSchema(args, tool.parameters ?? {}, "arguments").length === 0;

function commandKey(tool) {
  const properties = tool.parameters?.properties;
  if (!isRecord(properties)) return null;
  for (const key of ["command", "cmd", "script"]) {
    if (isRecord(properties[key]) && properties[key].type === "string") return key;
  }
  return null;
}

function forcedName(choice) {
  if (isString(choice)) return ["none", "auto", "required"].includes(choice) ? null : choice;
  if (!isRecord(choice)) return null;
  const fn = choice.function;
  return isRecord(fn) && isString(fn.name) ? fn.name : null;
}

function permits(choice, name) {
  if (choice == null || choice === "auto" || choice === "required") return true;
  if (choice === "none") return false;
  return forcedName(choice) === name;
}

/** Only one accepted call after a long, structured preamble is a document example, not a call. */
export function isM365ToolDocument(text, acceptedOffsets = [...text.matchAll(FENCE)].map((match) => match.index)) {
  if (acceptedOffsets.length !== 1) return false;
  const preamble = text.slice(0, acceptedOffsets[0]).trim();
  return preamble.length >= 1500 && /(^|\n)\s*(?:#{1,6}\s|\|.*\|)/.test(preamble);
}

/** Teach only declared tools, with one inert JSON example; the runtime stays the enforcement authority. */
export function buildM365ToolInstructions(tools, options = {}) {
  if (!tools.length || options.toolChoice === "none") return "";
  const eligible = tools.filter((t) => permits(options.toolChoice, t.name));
  if (!eligible.length) return "";
  const example = eligible.find((t) => !commandKey(t)) ?? eligible[0];
  const shell = eligible.find((t) => commandKey(t));
  return [
  "Tool protocol: emit a fenced block named for a declared tool, containing a JSON object of arguments. A call requests an action; do not invent tool results or claim commands have executed.",
  options.parallelToolCalls === false ? "Emit at most one call per turn." : "Multiple independent calls are permitted.",
  options.toolChoice === "required" || forcedName(options.toolChoice) ?
  "A permitted tool call is required." :
  "Answer normally when tools are unnecessary.",
  shell ?
  `Shell-language fences may target ${shell.name} using its ${commandKey(shell)} string argument. Do not emit example/sample commands: shell blocks are actions, not illustrations.` :
  "No shell tool is declared.",
  "Declared tools (JSON schemas):",
  JSON.stringify(eligible),
  `Format example only; never execute this example:\n\`\`\`${example.name}\n{}\n\`\`\``].
  join("\n");
}

const shellTarget = (tools, choice) => tools.find((tool) => commandKey(tool) && permits(choice, tool.name));
const callId = () => `call_${crypto.randomUUID()}`;

function hasMalformedOpener(text, tools, choice) {
  // A declared/alias opener left outside a complete fence is detectable malformed intent.
  const remainder = text.replace(FENCE, "");
  for (const opener of remainder.matchAll(/```([A-Za-z0-9_-]+)[ \t]*(?:\r?\n|$)/g)) {
    if (tools.some((tool) => tool.name === opener[1] && permits(choice, tool.name))) return true;
    if (SHELL_ALIASES.has(opener[1]) && shellTarget(tools, choice)) return true;
  }
  return false;
}

function parseFenceBody(body) {
  try {
    return { json: true, value: JSON.parse(body) };
  } catch {
    // Only shell aliases permit a non-JSON command body; declared JSON tools fail below.
    return { json: false };
  }
}

function hasUnknownCallable(value, tools) {
  // Undeclared fence names are ambiguous, not authoritative call detection: only an explicit callable
  // envelope naming an unknown tool rejects a batch; ordinary JSON/YAML/source examples stay text.
  if (!isRecord(value)) return false;
  return isString(value.name) && Object.hasOwn(value, "arguments") && !tools.some((tool) => tool.name === value.name);
}

function fenceArguments(name, body, parsed, target) {
  if (parsed.json) return isRecord(parsed.value) ? parsed.value : null;
  const key = SHELL_ALIASES.has(name) ? commandKey(target) : null;
  if (!key || /^[{[]/.test(body)) return null;
  return { [key]: body };
}

/** Null rejects the batch; undefined leaves an unrelated fence as prose. */
function parseFenceCandidate(match, tools, choice) {
  const name = match[1];
  const body = match[2].trim();
  const exact = tools.find((tool) => tool.name === name);
  if (exact && !permits(choice, exact.name)) return undefined;
  const parsed = parseFenceBody(body);
  const target = exact ?? (SHELL_ALIASES.has(name) ? shellTarget(tools, choice) : undefined);
  if (!target) return parsed.json && hasUnknownCallable(parsed.value, tools) ? null : undefined;
  const args = fenceArguments(name, body, parsed, target);
  if (!args || !validArguments(target, args)) return null;
  return [{ id: callId(), type: "function", name: target.name, arguments: JSON.stringify(args) }];
}

function collectFenceCalls(text, tools, choice) {
  const calls = [];
  const acceptedOffsets = [];
  if (hasMalformedOpener(text, tools, choice)) return null;
  for (const match of text.matchAll(FENCE)) {
    const candidate = parseFenceCandidate(match, tools, choice);
    if (candidate === null) return null;
    if (candidate === undefined) continue;
    calls.push(...candidate);
    acceptedOffsets.push(match.index);
  }
  return { calls, acceptedOffsets };
}

function missingCallConstraint(choice) {
  if (choice === "required") return "tool_required";
  return forcedName(choice) ? "forced_tool_missing" : undefined;
}

/**
 * Parse a completed turn into `{ text, calls, constraintViolation? }`. With no declared tools, or
 * `tool_choice: "none"`, the text is returned unchanged.
 */
export function parseM365ToolOutput(text, tools, options = {}) {
  const limit = options.maxTextLength ?? M365_MAX_TEXT_LENGTH;
  if (!Number.isSafeInteger(limit) || limit <= 0 || text.length > limit) {
    return { text: "", calls: [], constraintViolation: "text_limit" };
  }
  if (!tools.length || options.toolChoice === "none") return { text, calls: [] };
  const collected = collectFenceCalls(text, tools, options.toolChoice);
  if (!collected) return { text, calls: [], constraintViolation: "invalid_tool_arguments" };
  const documentGuarded = isM365ToolDocument(text, collected.acceptedOffsets);
  if (documentGuarded) collected.calls.length = 0;
  const selected = options.parallelToolCalls === false ? collected.calls.slice(0, 1) : collected.calls;
  const constraintViolation = selected.length ? undefined : missingCallConstraint(options.toolChoice);
  return {
    text,
    calls: selected,
    ...(documentGuarded ? { documentGuarded: true } : null),
    ...(constraintViolation ? { constraintViolation } : null)
  };
}
