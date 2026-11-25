/**
 * Providers that receive Structured Output as a prompt instruction can answer with
 * the JSON inside a ```json fence, which breaks clients that parse the content
 * (decolua/9router#2783). The fence is removed only when JSON was requested.
 *
 * Non-streaming only: a stream would need the fence removed across chunk boundaries.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

const FENCE = "```";
const FENCE_OPENER = /^```(?:json|JSON)?[ \t\r]*$/;

/**
 * Unwrap content that is exactly one fenced JSON block. String slicing keeps this
 * linear on long whitespace runs, which JSON mode models can emit.
 */
export function stripJsonFence(content) {
  if (!isString(content)) return content;
  const trimmed = content.trim();
  const openerEnd = trimmed.indexOf("\n");
  if (openerEnd < 0 || !trimmed.endsWith(FENCE) || !FENCE_OPENER.test(trimmed.slice(0, openerEnd))) return content;
  return trimmed.slice(openerEnd + 1, -FENCE.length).trim();
}

/** Return the Chat completion with its answers unfenced when the request asked for JSON. */
export function unfenceJsonChoices(requestBody, response) {
  const type = requestBody?.response_format?.type;
  if (type !== "json_schema" && type !== "json_object") return response;
  if (!Array.isArray(response?.choices)) return response;
  return {
    ...response,
    choices: response.choices.map((choice) => choice?.message ?
    { ...choice, message: { ...choice.message, content: stripJsonFence(choice.message.content) } } :
    choice)
  };
}
