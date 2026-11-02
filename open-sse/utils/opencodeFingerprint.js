/**
 * OpenCode free-tier tool fingerprint (port of decolua/9router 5bdcd5e7 +
 * 483c10f5).
 *
 * OpenCode v2 (/inference/v1) answers 403 FreeTierError unless the request
 * declares OpenCode's own `read` and `shell` tools with their exact
 * descriptions and parameter schemas. Stubbed descriptions and tool_choice
 * "none" are rejected too.
 *
 * Caller tools are sent untouched, except a tool that already uses an exact
 * fingerprint name with a different definition:
 * - when its parameters fit OpenCode's (no extra keys, required keys present)
 *   it adopts OpenCode's definition in place and keeps its name;
 * - otherwise it travels under an alias (`read_client`, ...) and the returned
 *   map (alias -> original) lets the response path restore the caller's name.
 * Case variants such as `Read` are preserved; upstream accepts them alongside
 * `read`.
 *
 * The system prompt must also carry the CLI's `<env>` block (upstream
 * ce060c79): without it, or without the tools, upstream answers 429
 * FreeUsageLimitError regardless of headers. See `applyEnvFingerprint`.
 */

import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Verbatim from the OpenCode v2.0.26 CLI. Upstream compares description and
// parameters, so do not reword or reformat these.
const FINGERPRINT_TOOL_DEFINITIONS = {
  read: {
    description: "Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to read" },
        offset: { type: "integer", minimum: 0, description: "The line or directory entry to start reading from (1-based)" },
        limit: { type: "integer", minimum: 0, description: "The maximum number of lines or directory entries to read (defaults to and capped at 2000)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  shell: {
    description: "Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command string to execute" },
        workdir: { type: "string", description: "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead." },
        timeout: { type: "integer", minimum: 0, description: "Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default." },
        background: { type: "boolean", description: "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

// Plain JSON object: not null, not an array.
const isRecord = (value) => Boolean(value) && isObject(value) && !Array.isArray(value);

export const OPENCODE_FINGERPRINT_TOOLS = Object.keys(FINGERPRINT_TOOL_DEFINITIONS);

/** "chat" ({type, function}), "responses" ({type, name}) or "claude" ({name, input_schema}). */
function toolDefinitionOf(tool, format) {
  if (!isRecord(tool)) return null;
  if (format === "chat") {
    const fn = tool.function;
    return isRecord(fn) ? fn : tool;
  }
  return tool;
}

function toolNameOf(tool, format) {
  const name = toolDefinitionOf(tool, format)?.name ?? tool?.name;
  return isString(name) ? name.trim() : "";
}

function schemaOf(def, format) {
  return format === "claude" ? def?.input_schema : def?.parameters;
}

function buildTool(tool, format, patch) {
  if (format === "chat" && isRecord(tool.function)) {
    return { ...tool, function: { ...tool.function, ...patch } };
  }
  return { ...tool, ...patch };
}

function definitionPatch(key, format) {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[key];
  return format === "claude" ? { description, input_schema: parameters } : { description, parameters };
}

function newFingerprintTool(key, format) {
  const patch = definitionPatch(key, format);
  if (format === "chat") return { type: "function", function: { name: key, ...patch } };
  if (format === "responses") return { type: "function", name: key, ...patch, strict: false };
  return { name: key, ...patch };
}

function isExactDefinition(tool, key, format) {
  const def = toolDefinitionOf(tool, format);
  const want = FINGERPRINT_TOOL_DEFINITIONS[key];
  return def?.description === want.description &&
    JSON.stringify(schemaOf(def, format)) === JSON.stringify(want.parameters);
}

// 483c10f5: the same tool with different wording (e.g. OpenCode's own `shell`
// run on another platform) can take OpenCode's definition without hiding or
// adding an argument the caller's handler expects.
function canNormalizeInPlace(tool, key, format) {
  const props = schemaOf(toolDefinitionOf(tool, format), format)?.properties;
  if (!isRecord(props)) return false;
  const want = FINGERPRINT_TOOL_DEFINITIONS[key].parameters;
  const declared = Object.keys(props);
  return declared.every((name) => name in want.properties) &&
    want.required.every((name) => declared.includes(name));
}

function concealCallerTools(tools, format) {
  const map = new Map();
  const taken = new Set(tools.map((tool) => toolNameOf(tool, format)));
  const seen = new Set();
  const out = [];
  for (const tool of tools) {
    const name = toolNameOf(tool, format);
    if (!OPENCODE_FINGERPRINT_TOOLS.includes(name)) {
      out.push(tool);
      continue;
    }
    // Duplicate declarations of one name are rejected upstream; keep the first.
    if (seen.has(name)) continue;
    seen.add(name);
    if (isExactDefinition(tool, name, format)) {
      out.push(tool);
    } else if (canNormalizeInPlace(tool, name, format)) {
      out.push(buildTool(tool, format, definitionPatch(name, format)));
    } else {
      let alias = `${name}_client`;
      for (let i = 2; taken.has(alias); i++) alias = `${name}_client${i}`;
      taken.add(alias);
      map.set(alias, name);
      out.push(buildTool(tool, format, { name: alias }));
    }
  }
  return { tools: out, map };
}

function retargetToolChoice(body, aliases) {
  const choice = body.tool_choice;
  if (!isRecord(choice)) return;
  if (isString(choice.name) && aliases.has(choice.name.trim())) {
    body.tool_choice = { ...choice, name: aliases.get(choice.name.trim()) };
    return;
  }
  const fnName = choice.function?.name;
  if (isString(fnName) && aliases.has(fnName.trim())) {
    body.tool_choice = { ...choice, function: { ...choice.function, name: aliases.get(fnName.trim()) } };
  }
}

// Prior-turn calls to an aliased caller tool must use the alias too, or the
// model reads them as calls to OpenCode's tool of the same name.
function aliasHistoryToolCalls(body, aliases) {
  if (Array.isArray(body.input)) {
    body.input = body.input.map((item) =>
      item?.type === "function_call" && aliases.has(item.name) ? { ...item, name: aliases.get(item.name) } : item);
  }
  if (!Array.isArray(body.messages)) return;
  body.messages = body.messages.map((msg) => {
    if (Array.isArray(msg?.tool_calls)) {
      return {
        ...msg,
        tool_calls: msg.tool_calls.map((call) => aliases.has(call?.function?.name) ?
          { ...call, function: { ...call.function, name: aliases.get(call.function.name) } } :
          call)
      };
    }
    if (msg?.role === "assistant" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((block) =>
          block?.type === "tool_use" && aliases.has(block.name) ? { ...block, name: aliases.get(block.name) } : block)
      };
    }
    return msg;
  });
}

// The appended tools carry real descriptions now, so the model would call them;
// tell it in the system prompt instead. Upstream wording: "not available" made
// the model also refuse the caller's own Read/Bash.
function noteUnavailableTools(body, format, names) {
  const list = names.map((name) => `\`${name}\``).join(" or ");
  const note = names.length > 1 ?
    `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.` :
    `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`;
  if (format === "responses") {
    body.instructions = isString(body.instructions) && body.instructions.trim() ?
      `${body.instructions}\n\n${note}` :
      note;
    return;
  }
  if (format === "claude") {
    if (Array.isArray(body.system)) body.system = [...body.system, { type: "text", text: note }];
    else body.system = isString(body.system) && body.system.trim() ? `${body.system}\n\n${note}` : note;
    return;
  }
  if (!Array.isArray(body.messages)) return;
  const first = body.messages[0];
  body.messages = first?.role === "system" && isString(first.content) ?
    [{ ...first, content: `${first.content}\n\n${note}` }, ...body.messages.slice(1)] :
    [{ role: "system", content: note }, ...body.messages];
}

// Upstream's gate reads the text only: a foreign system prompt plus this block
// passes, so it is appended to the caller's prompt, never replacing it.
// Upstream fills the paths from the gateway host (process.cwd(), os.tmpdir());
// fixed neutral values (Linux, matching the `shell` definition) keep the
// host's directory layout and OS out of the request.
const ENV_TAG = "<env>";
const ENV_FINGERPRINT_PROMPT = [
  "Here is some useful information about the environment you are running in:",
  ENV_TAG,
  "  Working directory: /workspace",
  "  Workspace root folder: /workspace",
  "  Is directory a git repo: no",
  "  Platform: linux",
  "  Prefer /tmp/opencode over generic system temporary directories such as /tmp; it is pre-created and approved for external access.",
  "</env>",
].join("\n");

function carriesEnv(system) {
  if (isString(system)) return system.includes(ENV_TAG);
  return Array.isArray(system) && system.some((block) => isString(block?.text) && block.text.includes(ENV_TAG));
}

// Append to a system prompt held as a string, text blocks, or unset.
function appendSystemText(system, text) {
  if (system === undefined || system === null) return text;
  if (isString(system)) return system.trim() ? `${system}\n\n${text}` : text;
  const blocks = Array.isArray(system) ? system : [];
  const last = blocks.findLastIndex((block) => isString(block?.text));
  if (last < 0) return [...blocks, { type: "text", text }];
  return blocks.map((block, i) => i === last ?
    { ...block, text: block.text.trim() ? `${block.text}\n\n${text}` : text } :
    block);
}

/**
 * Append the CLI's `<env>` marker to the system prompt of a Responses
 * (`instructions`), Claude (`system`) or chat (`messages[]` system) body.
 * A body that already carries the marker is left alone. Mutates `body`.
 *
 * @param {object} body
 * @param {"chat"|"responses"|"claude"} format
 * @returns {boolean} true when the marker was added
 */
export function applyEnvFingerprint(body, format) {
  if (!isRecord(body)) return false;
  if (format === "responses") {
    if (body.instructions !== undefined && !isString(body.instructions)) return false;
    if (carriesEnv(body.instructions)) return false;
    body.instructions = appendSystemText(body.instructions, ENV_FINGERPRINT_PROMPT);
    return true;
  }
  if (format === "claude") {
    if (carriesEnv(body.system)) return false;
    body.system = appendSystemText(body.system, ENV_FINGERPRINT_PROMPT);
    return true;
  }
  if (!Array.isArray(body.messages)) return false;
  const idx = body.messages.findIndex((msg) => msg?.role === "system");
  if (idx < 0) {
    body.messages = [{ role: "system", content: ENV_FINGERPRINT_PROMPT }, ...body.messages];
    return true;
  }
  const target = body.messages[idx];
  if (carriesEnv(target.content)) return false;
  const content = appendSystemText(target.content, ENV_FINGERPRINT_PROMPT);
  body.messages = body.messages.map((msg, i) => i === idx ? { ...msg, content } : msg);
  return true;
}

/**
 * Request-side pass: normalize or alias caller tools that collide with a
 * fingerprint name, append OpenCode's definitions for the missing ones and
 * mark those as off-limits. Mutates `body`.
 *
 * @param {object} body
 * @param {"chat"|"responses"|"claude"} format
 * @returns {Map<string,string>} sent alias -> caller's original name
 */
export function applyFingerprintTools(body, format) {
  if (!isRecord(body)) return new Map();
  const { tools, map } = concealCallerTools(Array.isArray(body.tools) ? body.tools : [], format);
  const declared = new Set(tools.map((tool) => toolNameOf(tool, format)));
  const appended = OPENCODE_FINGERPRINT_TOOLS.filter((name) => !declared.has(name));
  body.tools = [...tools, ...appended.map((name) => newFingerprintTool(name, format))];
  if (map.size) {
    const aliases = new Map([...map].map(([alias, original]) => [original, alias]));
    retargetToolChoice(body, aliases);
    aliasHistoryToolCalls(body, aliases);
  }
  if (appended.length) noteUnavailableTools(body, format, appended);
  applyEnvFingerprint(body, format);
  // Responses keeps its explicit auto default. Never default to "none":
  // upstream answers tool_choice "none" with 403 FreeTierError.
  if (format === "responses" && !body.tool_choice) body.tool_choice = "auto";
  return map;
}
