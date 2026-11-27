/**
 * Combo request planning (#2266). Turns the configured member list into the
 * ordered attempt list before any provider is called:
 *
 *   eligibility (context requirements) -> strategy rotation / smart scoring ->
 *   context-size sort -> capability auto-switch -> required-input filter ->
 *   task-aware reorder -> quota ranker -> lock ranker
 *
 * Planning never dispatches. It returns either a ready attempt plan or the
 * local error response the combo must answer with. Request-content helpers
 * (capability detection, task classification) stay in combo.js and are passed
 * in as `helpers`, which keeps this module free of an import cycle.
 */

import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { isFunction } from "../../../src/shared/utils/typeChecks.js";
import { filterByContextRequirements, sortByContextSize, validateContextRequirementsMembers } from "./contextRequirements.js";
import { getRotatedModels, hasWeightedRotation } from "./rotation.js";
import { getSmartScoredModels } from "./scoring.js";

function jsonError(status, error) {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

function rejected(log, status, message, extra = {}) {
  log.warn("COMBO", message);
  return { ok: false, response: jsonError(status, { message, ...extra }) };
}

export function isTaskRoutingStrategy(strategy) {
  return ["smart", "task", "task-aware", "task_aware", "auto"].includes(String(strategy || "").toLowerCase());
}

/** Order the eligible pool by the combo strategy. Mutates rotation state once. */
export function orderByStrategy({ models, comboName, comboStrategy, comboStickyLimit, conversationCacheKey, comboMembers, apiKeyId }) {
  if (comboStrategy === "smart-scoring") return getSmartScoredModels(models, comboName);
  return getRotatedModels(models, comboName, comboStrategy, comboStickyLimit, conversationCacheKey, comboMembers, apiKeyId);
}

// Rankers are diagnostics: an error or a result of another length keeps the order.
async function applyRanker(ranker, models) {
  try {
    const ordered = await ranker(models);
    return Array.isArray(ordered) && ordered.length === models.length ? ordered : models;
  } catch {
    return models;
  }
}

// Run each async step only when configured. With no classifier and no rankers
// the plan is returned synchronously, so dispatch starts in the same tick as
// before the extraction.
function chain(value, step) {
  return value instanceof Promise ? value.then(step) : step(value);
}

/**
 * Returns the plan directly when no async step is configured, otherwise a Promise.
 * @returns {ComboPlan | Promise<ComboPlan>} where ComboPlan is
 *   `{ ok: false, response: Response }` or `{ ok: true, activeModels, models,
 *   conversationCacheKey, toolOutputMedia }`
 */
export function planComboModels({
  body,
  models,
  log,
  comboName,
  comboStrategy,
  comboStickyLimit = 1,
  apiKeyId = null,
  autoSwitch = true,
  jevClassify = false,
  decisionBackend = null,
  quotaRanker = null,
  lockRanker = null,
  signal = null,
  contextRequirements = null,
  capabilitiesMap = null,
  comboMembers = []
}, helpers) {
  // #6546 (#6458): fail fast on an empty pool instead of looping zero times.
  if (!Array.isArray(models) || models.length === 0) {
    return rejected(log, 503, `Combo "${comboName}" has no models`);
  }

  // Eligibility runs BEFORE rotation/scoring so the round-robin pointer, sticky
  // rotation, smart scoring and conversation affinity all see the eligible pool.
  // Same reference when no requirement is configured.
  const memberCheck = validateContextRequirementsMembers(models, contextRequirements);
  if (!memberCheck.ok) return rejected(log, memberCheck.status, memberCheck.message);
  const activeModels = filterByContextRequirements(models, contextRequirements, log, capabilitiesMap);
  if (!Array.isArray(activeModels) || activeModels.length === 0) {
    return rejected(log, 503, `Combo "${comboName}" has no models matching context requirements`);
  }

  const conversationCacheKey = helpers.getConversationCacheKey(body);
  let ordered = orderByStrategy({ models: activeModels, comboName, comboStrategy, comboStickyLimit, conversationCacheKey, comboMembers, apiKeyId });

  // preferLargeContext sorts before capability and task reordering, so
  // hard-capability auto-switch can still move vision/audio models first.
  ordered = sortByContextSize(ordered, contextRequirements, log, capabilitiesMap);

  // Auto-switch satisfies request capabilities only. It must not override the
  // explicit Fallback/Round Robin order for plain text requests.
  const required = autoSwitch ? helpers.detectRequiredCapabilities(body) : new Set();
  if (autoSwitch && required.size > 0) {
    const reordered = helpers.reorderByCapabilities(ordered, required, capabilitiesMap);
    if (reordered[0] !== ordered[0]) log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
    ordered = reordered;
  }

  // Fusion requirements survive nested routing even when the nested router's
  // own auto-switch is off. Ordinary fallback keeps its tool-only admission.
  const toolOutputMedia = autoSwitch ? helpers.detectToolOutputCapabilities(body) : new Set();
  const fusionInput = helpers.getFusionRequiredInput(body);
  const inputMedia = [...new Set([...fusionInput, ...toolOutputMedia])];
  if (inputMedia.length > 0) {
    const capable = helpers.filterByInputCapabilities(ordered, inputMedia, capabilitiesMap);
    if (capable.length === 0) {
      const inputSource = fusionInput.length > 0 ? "required input" : "input returned by a tool";
      return rejected(log, HTTP_STATUS.BAD_REQUEST,
        `Combo "${comboName}" has no member that supports [${inputMedia.join(",")}] ${inputSource}`,
        { type: "invalid_request_error", code: "capability_unavailable" });
    }
    ordered = capable;
  }

  let result = ordered;
  if (autoSwitch && isTaskRoutingStrategy(comboStrategy)) {
    result = helpers.reorderForTask(ordered, { body, required, log, signal, jevClassify, decisionBackend, capabilitiesMap });
  }
  // Weighted orders are the selection itself; the quota ranker re-sorts by
  // index and would collapse them, so it only runs for the other strategies.
  // Fail-open: account selection still applies the atomic capacity gate.
  if (isFunction(quotaRanker) && comboStrategy !== "weighted" && !(comboStrategy === "round-robin" && hasWeightedRotation(comboName))) {
    result = chain(result, (current) => applyRanker(quotaRanker, current));
  }
  // Stable partition after strategy and quota ordering, including weighted picks.
  // Credential selection stays authoritative if inspection fails.
  if (isFunction(lockRanker)) result = chain(result, (current) => applyRanker(lockRanker, current));

  return chain(result, (finalOrder) => ({ ok: true, activeModels, models: finalOrder, conversationCacheKey, toolOutputMedia }));
}
