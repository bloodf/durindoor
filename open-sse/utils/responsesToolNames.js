// Request-side tool-name limit for OpenAI Responses upstreams (9router#4545).
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { MAX_TOOL_NAME_LEN } from "../config/appConstants.js";
import { createToolNameAliaser } from "../translator/concerns/toolCall.js";

// Only length is enforced here; no character is rewritten.
const NO_REWRITE = /(?!)/g;

/**
 * Shorten tool names longer than {@link MAX_TOOL_NAME_LEN} in a Responses body:
 * declarations (including namespace subtools), tool_choice and call history.
 * The alias is a hash of the full name, so two names sharing a prefix stay
 * distinct and a name keeps its alias across turns.
 *
 * Replaces `body.tools`, `body.input` and `body.tool_choice` with copies; the
 * objects the caller declared are left untouched.
 *
 * @param {object} body Responses request body.
 * @returns {Map<string,string>} alias -> caller's name, for the response path.
 */
export function aliasLongResponsesToolNames(body) {
  const { alias, aliases } = createToolNameAliaser({ invalidCharacters: NO_REWRITE, maxLength: MAX_TOOL_NAME_LEN });
  if (!isObject(body)) return aliases;

  const rename = (entry) => {
    if (!entry || !isObject(entry)) return entry;
    let next = entry;
    const name = isString(entry.name) ? entry.name.trim() : "";
    if (name.length > MAX_TOOL_NAME_LEN) next = { ...next, name: alias(name) };
    if (entry.function && isObject(entry.function)) {
      const fn = rename(entry.function);
      if (fn !== entry.function) next = { ...next, function: fn };
    }
    if (Array.isArray(entry.tools)) next = { ...next, tools: entry.tools.map(rename) };
    return next;
  };

  if (Array.isArray(body.tools)) {
    // A namespace's own name is not a callable tool name, so only its subtools change.
    body.tools = body.tools.map((tool) => tool?.type === "namespace" && Array.isArray(tool.tools) ?
      { ...tool, tools: tool.tools.map(rename) } :
      rename(tool));
  }
  if (body.tool_choice && isObject(body.tool_choice)) body.tool_choice = rename(body.tool_choice);
  if (Array.isArray(body.input)) {
    // Only call items carry a tool name; message parts may use `name` for other things.
    body.input = body.input.map((item) => /^(function|custom_tool)_call$/.test(item?.type) ? rename(item) : item);
  }
  return aliases;
}

/**
 * Attach the alias map chatCore reads to restore names. Non-enumerable so it
 * never reaches the provider JSON. An empty map keeps an earlier one, which is
 * what a retry over an already-aliased body produces.
 */
export function attachToolNameMap(body, aliases) {
  if (body && aliases?.size) {
    Object.defineProperty(body, "_toolNameMap", { value: aliases, configurable: true });
  }
  return body;
}
