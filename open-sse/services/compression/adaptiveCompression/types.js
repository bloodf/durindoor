import { isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

/**
 * Context-budget adaptive compression — shared types + safe defaults (JS port).
 *
 * Naming note: "adaptiveCompression"/"contextBudget" — NOT "headroom" (which is an
 * unrelated existing engine). "headroom" here = the budget signal (target − prompt tokens).
 */

/**
 * @typedef {"reserve-output"|"percentage"|"absolute"} ContextBudgetPolicy
 * @typedef {"floor"|"replace-autotrigger"|"off"} ContextBudgetMode
 * @typedef {{ engine: string, intensity?: string }} LadderStage
 */

/** Safe defaults applied when a field is absent (design §4.4 / §6). */
export const DEFAULT_CONTEXT_BUDGET = {
  mode: "off",
  policy: "reserve-output",
  outputReserve: 4096,
  safetyMargin: 1024,
  pct: 0.85,
  absoluteBudget: 0,
};

const MODES = new Set(["off", "floor", "replace-autotrigger"]);
const POLICIES = new Set(["reserve-output", "percentage", "absolute"]);
const nonNegative = (v) => Number.isFinite(v) && v >= 0;

/**
 * Validate an operator-supplied context-budget config (settings.compressionAdaptive).
 * Unknown or invalid fields fall back to DEFAULT_CONTEXT_BUDGET; never throws.
 * ladderOverride is accepted only as an array of { engine: string, intensity?: string }.
 */
export function normalizeContextBudgetConfig(raw) {
  const cfg = raw && isObject(raw) && !Array.isArray(raw) ? raw : {};
  const out = {
    mode: MODES.has(cfg.mode) ? cfg.mode : DEFAULT_CONTEXT_BUDGET.mode,
    policy: POLICIES.has(cfg.policy) ? cfg.policy : DEFAULT_CONTEXT_BUDGET.policy,
    outputReserve: nonNegative(cfg.outputReserve) ? Math.floor(cfg.outputReserve) : DEFAULT_CONTEXT_BUDGET.outputReserve,
    safetyMargin: nonNegative(cfg.safetyMargin) ? Math.floor(cfg.safetyMargin) : DEFAULT_CONTEXT_BUDGET.safetyMargin,
    pct: Number.isFinite(cfg.pct) && cfg.pct > 0 && cfg.pct <= 1 ? cfg.pct : DEFAULT_CONTEXT_BUDGET.pct,
    absoluteBudget: nonNegative(cfg.absoluteBudget) ? Math.floor(cfg.absoluteBudget) : DEFAULT_CONTEXT_BUDGET.absoluteBudget,
  };
  if (Array.isArray(cfg.ladderOverride)) {
    const ladder = cfg.ladderOverride.filter((s) => s && isString(s.engine) &&
      (s.intensity === undefined || isString(s.intensity))).
      map((s) => s.intensity ? { engine: s.engine, intensity: s.intensity } : { engine: s.engine });
    if (ladder.length > 0) out.ladderOverride = ladder;
  }
  return out;
}
