/**
 * Compatibility repairs for the Responses wire Grok Build accepts: replayed
 * input history, the tool list and `tool_choice` (upstream decolua/9router#2647).
 * Every function returns new values and leaves its input untouched.
 */
import { ROLE, RESPONSES_ITEM } from "../translator/schema/index.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

// Codex CLI bookkeeping that is not part of the Responses wire format.
const CLIENT_METADATA_FIELD = "internal_chat_message_metadata_passthrough";
const OUTPUT_PART_TYPES = new Set(["input_text", "input_image", "input_file", "output_text", "text"]);
// Server-side search tools: one declaration each, and no function may share the name.
const SEARCH_TOOL_TYPES = new Set(["web_search", "x_search"]);
const MAX_TOOL_NAME_LENGTH = 128;

function isTypedContent(output) {
  return Array.isArray(output) && output.length > 0 &&
    output.every((part) => isRecord(part) && OUTPUT_PART_TYPES.has(part.type));
}

function toJsonArguments(value) {
  if (!isString(value)) return JSON.stringify(value ?? {});
  try {
    JSON.parse(value);
    return value;
  } catch {
    return "{}";
  }
}

function normalizeItem(item) {
  if (!isRecord(item)) return item;
  const { [CLIENT_METADATA_FIELD]: _metadata, ...next } = item;
  if (next.role === ROLE.DEVELOPER) next.role = ROLE.SYSTEM;
  if (next.type === RESPONSES_ITEM.FUNCTION_CALL) {
    next.arguments = toJsonArguments(next.arguments);
  } else if (next.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT && !isString(next.output) && !isTypedContent(next.output)) {
    next.output = JSON.stringify(next.output ?? null);
  }
  return next;
}

const isCall = (item) => item?.type === RESPONSES_ITEM.FUNCTION_CALL && Boolean(item.call_id);
const isOutput = (item) => item?.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT;
const isCallOrOutput = (item) => item?.type === RESPONSES_ITEM.FUNCTION_CALL || isOutput(item);

// An output with no earlier call (truncated history) is kept as user text.
function orphanOutputMessage(item) {
  const label = `Result of an earlier tool call (${item.call_id || "unknown id"}):`;
  const content = isTypedContent(item.output) ?
    [{ type: RESPONSES_ITEM.INPUT_TEXT, text: label }, ...item.output.map((part) =>
      isString(part.text) ? { type: RESPONSES_ITEM.INPUT_TEXT, text: part.text } : part)] :
    [{ type: RESPONSES_ITEM.INPUT_TEXT, text: `${label} ${item.output}` }];
  return { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content };
}

/**
 * Make every replayed function call pair with exactly one output: repeated calls
 * are dropped, the last repeated output wins, a call with no output gets one
 * saying it did not run, and an orphan output becomes user text.
 */
export function normalizeGrokCliHistory(input) {
  if (!Array.isArray(input)) return input;
  const items = input.map(normalizeItem);
  const callAt = new Map();
  const outputAt = new Map();
  items.forEach((item, index) => {
    if (isCall(item) && !callAt.has(item.call_id)) callAt.set(item.call_id, index);
    else if (isOutput(item) && callAt.has(item.call_id)) outputAt.set(item.call_id, index);
  });

  const repaired = [];
  let unanswered = [];
  items.forEach((item, index) => {
    if (isCall(item)) {
      if (callAt.get(item.call_id) !== index) return;
      repaired.push(item);
      if (!outputAt.has(item.call_id)) unanswered.push(item);
    } else if (isOutput(item)) {
      if (!callAt.has(item.call_id) || callAt.get(item.call_id) > index) repaired.push(orphanOutputMessage(item));
      else if (outputAt.get(item.call_id) === index) repaired.push(item);
    } else {
      repaired.push(item);
    }
    // Answer cancelled calls at the end of their call/output run.
    if (unanswered.length && !isCallOrOutput(items[index + 1])) {
      repaired.push(...unanswered.map((call) => ({
        type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
        call_id: call.call_id,
        output: `Tool \`${call.name}\` was not executed: no result was recorded.`,
      })));
      unanswered = [];
    }
  });
  return repaired;
}

function chosenFunctionName(choice) {
  if (!isRecord(choice) || !["function", "custom"].includes(choice.type)) return "";
  const name = choice.name ?? choice.function?.name;
  return isString(name) ? name.trim().slice(0, MAX_TOOL_NAME_LENGTH) : "";
}

/**
 * Dedupe the search tools and apply the provider's tool cap without cutting a
 * hosted tool or the function `tool_choice` selects.
 */
export function limitGrokCliTools(tools, toolChoice, limit) {
  const searchTypes = new Set(tools.filter((tool) => SEARCH_TOOL_TYPES.has(tool.type)).map((tool) => tool.type));
  const seen = new Set();
  const unique = tools.filter((tool) => {
    if (tool.type === "function") return !searchTypes.has(tool.name);
    if (!SEARCH_TOOL_TYPES.has(tool.type)) return true;
    if (seen.has(tool.type)) return false;
    seen.add(tool.type);
    return true;
  });
  if (unique.length <= limit) return unique;

  const preferred = chosenFunctionName(toolChoice);
  const required = new Set(unique.filter((tool) => tool.type !== "function" || tool.name === preferred));
  let room = limit - required.size;
  return unique.filter((tool) => required.has(tool) || room-- > 0).slice(0, limit);
}

/**
 * Resolve `tool_choice` against the final tool list. Custom and nested function
 * forms become the flat function form (custom tools are sent as functions);
 * a choice naming a missing function, or any choice without tools, is dropped.
 */
export function normalizeGrokCliToolChoice(choice, tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  if (!isRecord(choice) || !["function", "custom"].includes(choice.type)) return choice;
  const name = chosenFunctionName(choice);
  return tools.some((tool) => tool.type === "function" && tool.name === name) ?
    { type: "function", name } :
    undefined;
}
