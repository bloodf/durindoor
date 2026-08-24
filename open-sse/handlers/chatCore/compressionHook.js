// F-1b compression seam — single execution path for the chatCore engine loop.
//
// Static-imports the F-1a compression service and registers builtin engines at
// module init (registerBuiltinEngines() is synchronous + idempotent). The
// disabled request path is preserved behaviorally: cfg.enabled !== true returns
// { body, headerValue: null } BEFORE any engine is resolved or applied, so the
// body reference is untouched even though the module graph is loaded.
//
// Production contract:
//   deriveDefaultPlan(engines, masterEnabled) -> { mode, stackedPipeline }
//   resolveAdaptivePlan({ basePlan, estimatedTokens, modelContextLimit, requestMaxTokens, config })
//      -> { plan: { mode, stackedPipeline }, telemetry }
//   planToEngineIds(planOrWrapper) -> string[]   (handles stacked + single-mode reverse map)
//   isEngineAvailable(id) -> boolean
//   getEngine(id).apply(body, { config, stepConfig }) -> Promise<{ body, compressed, stats }>
//   Engines NEVER mutate the caller's body; getEngine throws on unknown ids.
//
// Returns { body, headerValue }:
//   - body: possibly-compressed body; original reference on disabled/no-op.
//   - headerValue: string for the X-DurinDoor-Compression response header when at
//     least one engine actually compressed (result.compressed === true) and the
//     final body differs from the input; otherwise null. Format:
//       "<engineId>[,<engineId>...]|<overallSavingsPercent>%"
//     overallSavingsPercent is computed from the stack INPUT vs final OUTPUT
//     token estimate (NOT a sum of per-engine percentages), rounded to 2 dp.
//
// `deps` is an optional DI override used ONLY by tests/embedding hosts. When
// present it substitutes the real functions; production uses the static imports.

import {
  getEngine as realGetEngine,
  isEngineAvailable as realIsEngineAvailable,
  planToEngineIds as realPlanToEngineIds,
  registerBuiltinEngines } from
"../../services/compression/index.js";
import { deriveDefaultPlan as realDeriveDefaultPlan } from "../../services/compression/deriveDefaultPlan.js";
import { resolveAdaptivePlan as realResolveAdaptivePlan } from "../../services/compression/adaptiveCompression/resolveAdaptivePlan.js";
import { estimateCompressionTokens } from "../../services/compression/stats.js";
import { isObject } from "../../../src/shared/utils/typeChecks.js";

try {
  registerBuiltinEngines();
} catch {

  // Registration must never break module load; getEngine self-registers on demand too.
}
/**
 * Run the compression engine loop.
 *
 * @param {object} body translatedBody (final provider shape)
 * @param {object} [deps] optional DI override { isEngineAvailable, getEngine,
 *        deriveDefaultPlan, resolveAdaptivePlan, planToEngineIds } (tests only)
 * @param {object} cfg  { enabled, engines, applyOpts, adaptive, log }
 * @returns {Promise<{body: object, headerValue: string|null}>}
 */
export async function runCompressionSeam(body, deps, cfg = {}) {
  const none = { body, headerValue: null };
  if (!cfg?.enabled) return none; // disabled: never touch engines

  const isEngineAvailable = deps?.isEngineAvailable ?? realIsEngineAvailable;
  const getEngine = deps?.getEngine ?? realGetEngine;
  const deriveDefaultPlan = deps?.deriveDefaultPlan ?? realDeriveDefaultPlan;
  const resolveAdaptivePlan = deps?.resolveAdaptivePlan ?? realResolveAdaptivePlan;
  const planToEngineIds = deps?.planToEngineIds ?? realPlanToEngineIds;

  let engineIds;
  let stepById = {};
  try {
    const basePlan = deriveDefaultPlan(cfg.engines || {}, true);
    const adaptive = cfg.adaptive || {};
    // Forward the FULL adaptive config when a mode is supplied so computeTarget()
    // sees every budget field it dereferences (outputReserve/safetyMargin/pct/
    // absoluteBudget). mode:"off" short-circuits the resolver before any of
    // those reads, so a bare { mode:"off" } stays safe for the non-adaptive path.
    const config = adaptive.mode ?
    { policy: "default", ...adaptive } :
    { mode: "off" };
    const resolved = resolveAdaptivePlan({
      basePlan,
      estimatedTokens: adaptive.estimatedTokens ?? 0,
      modelContextLimit: adaptive.modelContextLimit ?? 0,
      requestMaxTokens: adaptive.requestMaxTokens ?? 0,
      config
    });
    const plan = resolved?.plan ?? resolved ?? basePlan;
    engineIds = planToEngineIds(plan);
    for (const step of plan?.stackedPipeline || []) {
      if (step && step.engine) stepById[step.engine] = step;
    }
  } catch (e) {
    cfg.log?.warn?.("COMPRESS", `plan derivation failed, body unchanged: ${e?.message || e}`);
    return none; // planning failed -> fail-open
  }

  if (!Array.isArray(engineIds) || engineIds.length === 0) return none; // nothing to run

  const inputTokens = estimateCompressionTokens(body);
  const inputSerialized = JSON.stringify(body);

  // Per-engine fail-open: availability check + dispatch + apply are wrapped together,
  // so an unknown/unavailable id (getEngine throws) or a throwing apply rolls back
  // ONLY this step and the loop continues.
  let working = body;
  const compressedEngineIds = [];
  for (const id of engineIds) {
    const stepInput = working;
    try {
      if (!isEngineAvailable(id)) continue; // unavailable -> skip, keep stepInput
      // Always forward stepConfig per contract {config, stepConfig}. Stacked steps
      // carry the real planner step (with intensity); single-mode plans have an
      // empty stackedPipeline, so synthesize a minimal {engine} step.
      const step = stepById[id] ?? { engine: id };
      const opts = { config: cfg.applyOpts || {}, stepConfig: step };
      const res = await getEngine(id).apply(working, opts);
      if (!res || !isObject(res) || !res.body || !isObject(res.body)) {
        throw new Error(`engine ${id} returned malformed result`);
      }
      const stepOutSerialized = JSON.stringify(res.body);
      working = res.body;
      // Credit the engine only when it BOTH reports compression AND actually
      // changed this step's body. A compressed:true no-op clone must not be
      // advertised, and the engine must not appear in the header list.
      if (res.compressed === true && stepOutSerialized !== JSON.stringify(stepInput)) {
        compressedEngineIds.push(id);
      }
    } catch (e) {
      cfg.log?.warn?.("COMPRESS", `engine ${id} failed, step rolled back: ${e?.message || e}`);
      working = stepInput; // roll back only this step; continue
    }
  }

  if (compressedEngineIds.length === 0) return none;

  // Require an actual content change: engines may return a fresh-but-identical
  // clone with compressed:true (no-op pass). Reference identity is not a signal.
  const outputSerialized = JSON.stringify(working);
  if (outputSerialized === inputSerialized) return none;

  const outputTokens = estimateCompressionTokens(working);
  const savingsPercent =
  inputTokens > 0 ? Math.round((inputTokens - outputTokens) / inputTokens * 10000) / 100 : 0;

  return {
    body: working,
    headerValue: `${compressedEngineIds.join(",")}|${savingsPercent}%`
  };
}