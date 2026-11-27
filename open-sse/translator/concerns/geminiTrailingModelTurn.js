// Gemini 3/4 chat models reject a request whose history ends on a model turn.
// Shared by the Vertex and Antigravity executors. Adapted from MIT-licensed
// diegosouzapw/OmniRoute PR 21439 (head 35e01594ad13a7ffc0cd44d6598f6d862dfcff9f),
// open-sse/translator/helpers/geminiTrailingModelTurn.ts.
import { isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * True for Gemini 3.x/4.x and `gemini-pro-agent` chat models, with or without a
 * `provider/` prefix. Image models keep their trailing model turns.
 *
 * @param {unknown} model - Upstream model id.
 * @returns {boolean}
 */
export function isGeminiTrailingModelTurnRejectingModel(model) {
  if (!isString(model)) return false;
  const bare = model.toLowerCase().split("/").pop();
  if (/(?:^|-)image(?:-|$)/.test(bare)) return false;
  return /^gemini-(?:[34](?:\.\d+)?(?:-[a-z0-9-]+)?|pro-agent)$/.test(bare);
}
