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
