/**
 * Complete JSON response document served under the event-stream media type.
 *
 * A forced-streaming upstream answering a non-streaming client can return one
 * whole JSON document (an OpenAI `chat.completion`, a Responses `response`, a
 * Claude `message`, or a structured error envelope) with
 * `Content-Type: text/event-stream`, sometimes with a `data: [DONE]` sentinel
 * glued after the closing brace. None of its lines is a `data:` frame, so the
 * buffered event-stream parsers find nothing and the request used to fail as an
 * invalid event stream. This reads such a body as the non-stream response it
 * is. Anything that is not exactly one recognised JSON document (truncated
 * JSON, trailing garbage, an unknown object, a bare stream chunk) returns null
 * so the caller keeps its invalid-event-stream failure.
 *
 * Ported from OmniRoute #18377.
 */
import { FORMATS } from "../../translator/formats.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

/** A `data: [DONE]` sentinel glued to the closing brace of the document. */
const TRAILING_DONE_SENTINEL = /data:[ \t]*\[DONE\]\s*$/;

/**
 * Dialect of a complete JSON response document.
 *
 * @param {object} doc parsed JSON record
 * @returns {string|null} the dialect, or null for an unrecognised object
 */
function detectDocumentFormat(doc) {
  if (Array.isArray(doc.choices) && doc.choices.some((choice) => isRecord(choice) && isRecord(choice.message))) return FORMATS.OPENAI;
  if (doc.object === "response" && Array.isArray(doc.output)) return FORMATS.OPENAI_RESPONSES;
  if (doc.type === "message" && Array.isArray(doc.content)) return FORMATS.CLAUDE;
  return null;
}

/**
 * A structured provider error envelope (`{error: ...}`).
 *
 * @param {object} doc parsed JSON record
 * @returns {boolean} whether the record carries an error envelope
 */
function hasStructuredError(doc) {
  const error = doc.error;
  return (isString(error) && error.length > 0) || (isRecord(error) && Object.keys(error).length > 0);
}

/**
 * Read one complete JSON response document from an event-stream body.
 *
 * The document names its own dialect: the transport label only survives when
 * it names the same dialect, so a Responses transport label never hides a
 * chat-completion document (or the other way round).
 *
 * @param {string} rawBody buffered provider body
 * @param {string} targetFormat transport format of the provider response
 * @returns {{body: object, format: string}|null} the document and its dialect
 */
export function parseJsonDocumentBehindEventStream(rawBody, targetFormat) {
  const text = String(rawBody || "").trim().replace(TRAILING_DONE_SENTINEL, "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;

  let doc;
  try {doc = JSON.parse(text);} catch {return null;}
  if (!isRecord(doc)) return null;

  const format = detectDocumentFormat(doc);
  if (format) return { body: doc, format };
  // An error envelope is handled like the same body served as application/json.
  if (hasStructuredError(doc)) return { body: doc, format: targetFormat };
  return null;
}

/**
 * Rebuild the Claude event stream a complete Claude message document stands for.
 *
 * The buffered Claude parser works on events; a complete message document is
 * the same turn in one piece. Replaying it as events keeps one parser — and
 * one native-message overlay — for both shapes.
 *
 * @param {object} message a complete Claude message document
 * @returns {string} the equivalent event-stream text
 */
export function claudeMessageDocumentToEventStream(message) {
  const { content, usage, stop_reason: stopReason, ...rest } = message;
  const events = [{ type: "message_start", message: { ...rest, content: [], usage } }];

  let index = 0;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text || "" } });
      events.push({ type: "content_block_stop", index });
    } else if (block?.type === "thinking") {
      events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking || "" } });
      events.push({ type: "content_block_stop", index });
    } else if (block?.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) } });
      events.push({ type: "content_block_stop", index });
    }
    index++;
  }

  events.push({ type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: usage?.output_tokens } });
  events.push({ type: "message_stop" });
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}
