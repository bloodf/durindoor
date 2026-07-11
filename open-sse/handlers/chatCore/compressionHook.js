// F-1b compression seam — chatCore engine loop (F1d/F1g contract).
//
// Static-imports the F-1a compression service and registers builtin engines at
// module init (F1d: registerBuiltinEngines() is synchronous + idempotent). chatCore
// only imports THIS module when compressionV2Enabled is true (dynamic import gate
// in chatCore.js), so the disabled path still loads none of this graph.
//
// Production contract (feat/compression-stack @ 2b05ea6b):
//   deriveDefaultPlan(engines, masterEnabled) -> { mode, stackedPipeline }
//   resolveAdaptivePlan({ basePlan, estimatedTokens, modelContextLimit, requestMaxTokens, config })
//      -> { plan: { mode, stackedPipeline }, telemetry }
//   planToEngineIds(planOrWrapper) -> string[]   (handles stacked + single-mode reverse map)
//   isEngineAvailable(id) -> boolean
//   getEngine(id).apply(body, { config, stepConfig }) -> Promise<{ body, compressed, stats }>
//   Engines NEVER mutate the caller's body; getEngine throws on unknown ids.
//
// Wiring:
//   basePlan = deriveDefaultPlan(engines, true)
//   plan     = resolveAdaptivePlan({ basePlan, ..., config }).plan
//              adaptive runs ONLY when cfg.adaptive supplies { mode } + a positive
//              modelContextLimit; otherwise the resolver returns basePlan unchanged
//              (mode "off" / unknown-limit pass-through — the public non-adaptive path).
//   for id of planToEngineIds(plan):
//       if isEngineAvailable(id): body = (await getEngine(id).apply(body, {config, stepConfig})).body
//       per-engine try/catch -> keep that step's input body and continue (fail-open).
//
// `deps` is an optional DI override used ONLY by tests/embedding hosts. When present
// it substitutes the real functions; production always uses the static imports above.

import {
  getEngine as realGetEngine,
  isEngineAvailable as realIsEngineAvailable,
  planToEngineIds as realPlanToEngineIds,
  registerBuiltinEngines,
} from "../../services/compression/index.js";
import { deriveDefaultPlan as realDeriveDefaultPlan } from "../../services/compression/deriveDefaultPlan.js";
import { resolveAdaptivePlan as realResolveAdaptivePlan } from "../../services/compression/adaptiveCompression/resolveAdaptivePlan.js";

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
 * @returns {Promise<object>} (possibly) compressed body; original body on disabled/no-op
 */
export async function runCompressionSeam(body, deps, cfg = {}) {
  if (!cfg?.enabled) return body; // disabled: never touch engines

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
    const config = adaptive.mode
      ? {
          mode: adaptive.mode,
          policy: adaptive.policy || "default",
          ...(adaptive.ladderOverride ? { ladderOverride: adaptive.ladderOverride } : {}),
        }
      : { mode: "off" };
    const resolved = resolveAdaptivePlan({
      basePlan,
      estimatedTokens: adaptive.estimatedTokens ?? 0,
      modelContextLimit: adaptive.modelContextLimit ?? 0,
      requestMaxTokens: adaptive.requestMaxTokens ?? 0,
      config,
    });
    const plan = resolved?.plan ?? resolved ?? basePlan;
    engineIds = planToEngineIds(plan);
    for (const step of plan?.stackedPipeline || []) {
      if (step && step.engine) stepById[step.engine] = step;
    }
  } catch (e) {
    cfg.log?.warn?.("COMPRESS", `plan derivation failed, body unchanged: ${e?.message || e}`);
    return body; // planning failed -> fail-open
  }

  if (!Array.isArray(engineIds) || engineIds.length === 0) return body; // nothing to run

  // Per-engine fail-open: availability check + dispatch + apply are wrapped together,
  // so an unknown/unavailable id (getEngine throws) or a throwing apply rolls back
  // ONLY this step and the loop continues (parent F1g authority).
  let working = body;
  for (const id of engineIds) {
    const stepInput = working;
    try {
      if (!isEngineAvailable(id)) continue; // unavailable -> skip, keep stepInput
      // Always forward stepConfig per parent contract {config, stepConfig}. Stacked
      // steps carry the real planner step (with intensity); single-mode plans have
      // an empty stackedPipeline, so synthesize a minimal {engine} step.
      const step = stepById[id] ?? { engine: id };
      const opts = { config: cfg.applyOpts || {}, stepConfig: step };
      const res = await getEngine(id).apply(working, opts);
      if (!res || typeof res !== "object" || !res.body || typeof res.body !== "object") {
        throw new Error(`engine ${id} returned malformed result`);
      }
      working = res.body;
    } catch (e) {
      cfg.log?.warn?.("COMPRESS", `engine ${id} failed, step rolled back: ${e?.message || e}`);
      working = stepInput; // roll back only this step; continue
    }
  }

  return working;
}
