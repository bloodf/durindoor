/**
 * Pure target-token computation (design D-C1). No clock, no DB, no tokenizer.
 *
 * @param {string} policy            active target policy
 * @param {number} modelContextLimit the resolved upstream model's context window (impure caller looks it up)
 * @param {number|null} requestMaxTokens  request.max_tokens, if the client sent one (reserve-output only)
 * @param {object} config            reserves / margin / pct / absoluteBudget
 * @returns {number} the maximum prompt-token target the compressed request should fit within
 */
import { isNumber } from "../../../../src/shared/utils/typeChecks.js";
export function computeTarget(policy, modelContextLimit, requestMaxTokens, config) {
  if (policy === "absolute") {
    return Math.max(0, Math.floor(config.absoluteBudget));
  }
  if (policy === "percentage") {
    const pct = config.pct > 0 && config.pct <= 1 ? config.pct : 1;
    return Math.max(0, Math.floor(modelContextLimit * pct));
  }
  // reserve-output (default): limit − output reservation − safety margin.
  const reserve =
  isNumber(requestMaxTokens) && requestMaxTokens > 0 ?
  requestMaxTokens :
  config.outputReserve;
  return Math.max(0, Math.floor(modelContextLimit - reserve - config.safetyMargin));
}