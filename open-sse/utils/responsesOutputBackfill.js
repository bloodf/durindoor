// Rebuild `response.output` on a Responses passthrough stream whose final event
// carries none, so clients that read only the terminal snapshot see every item.
import { MAX_PROVIDER_BODY_BYTES, MAX_RESPONSES_OUTPUT_ITEMS } from "../config/runtimeConfig.js";
import { isNumber, isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call"]);
const itemKey = (index, id) => isNumber(index) ? index : id;

export function createResponsesOutputBackfill() {
  const items = new Map();
  const openCalls = new Map();
  let bytes = 0;
  let overflowed = false;

  const keep = (key, item) => {
    bytes += JSON.stringify(item).length;
    // A partial snapshot would misreport the turn, so an oversized one is not rebuilt.
    overflowed ||= bytes > MAX_PROVIDER_BODY_BYTES || items.size >= MAX_RESPONSES_OUTPUT_ITEMS;
    if (overflowed) items.clear();
    else items.set(key, item);
  };

  const observe = (event) => {
    const { type, item } = event;
    if (type === "response.output_item.done" && isRecord(item)) {
      keep(itemKey(event.output_index, item.id), item);
    } else if (type === "response.output_item.added" && TOOL_CALL_TYPES.has(item?.type)) {
      if (openCalls.size < MAX_RESPONSES_OUTPUT_ITEMS) openCalls.set(itemKey(event.output_index, item.id), item);
    } else if (type === "response.function_call_arguments.done" && isString(event.arguments)) {
      const key = itemKey(event.output_index, event.item_id);
      const open = openCalls.get(key);
      // The `done` item is authoritative; this copy covers a stream without one.
      if (open && !items.has(key)) keep(key, { ...open, arguments: event.arguments, status: "completed" });
    }
  };

  /** Record the event; true when it was the final one and its output was filled in. */
  return (event) => {
    if (!isRecord(event)) return false;
    if (event.type !== "response.completed") {
      observe(event);
      return false;
    }
    if (!isRecord(event.response) || event.response.output?.length || !items.size) return false;
    const ordered = [...items].sort(([a], [b]) => isNumber(a) && isNumber(b) ? a - b : 0);
    event.response = { ...event.response, output: ordered.map(([, value]) => value) };
    return true;
  };
}
