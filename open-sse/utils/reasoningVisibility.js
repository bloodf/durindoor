import { REASONING_HEADER } from "../config/runtimeConfig.js";

/**
 * Keep non-streaming OpenAI reasoning by default; strip text-bearing reasoning
 * only when a client sends `x-9router-reasoning: off` or the deployment sets
 * `STRIP_REASONING_CONTENT` to a truthy value. Reasoning-only replies remain
 * intact because that field is their only useful output.
 *
 * @param {object|null|undefined} response - OpenAI-compatible response payload.
 * @param {object|null|undefined} clientRawRequest - Raw client request metadata.
 * @returns {object|null|undefined} The same response payload, possibly stripped in place.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";
export function applyReasoningVisibility(response, clientRawRequest) {
  const header = clientRawRequest?.headers?.[REASONING_HEADER];
  const env = process.env.STRIP_REASONING_CONTENT?.trim().toLowerCase();
  const shouldStrip = isString(header) && header.toLowerCase() === "off" ||
  ["1", "true", "on", "yes"].includes(env);
  if (!shouldStrip || !response?.choices) return response;

  for (const choice of response.choices) {
    if (choice?.message?.reasoning_content && choice.message.content) {
      delete choice.message.reasoning_content;
    }
  }
  return response;
}