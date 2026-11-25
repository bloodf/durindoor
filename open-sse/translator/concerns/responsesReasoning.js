import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * Move the translator's flat `reasoning_effort` into the `reasoning.effort`
 * shape a Responses endpoint requires (upstream decolua/9router#4610). Call it
 * at the final wire boundary only: the translated body stays flat until then.
 *
 * @param {object} body Responses-bound request body; never mutated.
 * @returns {object} The nested body, or the original body when unchanged.
 */
export function nestResponsesReasoningEffort(body) {
  if (!isString(body?.reasoning_effort)) return body;
  const { reasoning_effort: effort, ...rest } = body;
  return { ...rest, reasoning: { ...(isRecord(body.reasoning) ? body.reasoning : null), effort } };
}
