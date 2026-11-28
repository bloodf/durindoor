import { isString } from "../../src/shared/utils/typeChecks.js";

/** Native Liquid decisions use a fixed origin; model IDs only enter JSON. */
export const LIQUID_SYSTEMONE_URL = "https://api.liquid.ai/decisions/v1/systemone";

export function isLiquidDecisionModel(model) {
  return isString(model) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}(?![\s\S])/.test(model) && !model.includes("..");
}
