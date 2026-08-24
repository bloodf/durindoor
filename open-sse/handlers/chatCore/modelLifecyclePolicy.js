import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import {
  formatModelLifecycleMessage,
  getModelLifecycleDecision } from
"../../services/modelLifecycle.js";
import { createErrorResult } from "../../utils/error.js";

/**
 * Evaluate the lifecycle decision for BOTH the canonical catalog id and the
 * resolved upstream id. A shutdown on either side short-circuits the request
 * with HTTP 410 because aliases that route to a retired model must surface the
 * same error the shutdown model would have triggered. Deprecated models only
 * log a warning — active traffic keeps flowing.
 *
 * Returns an `ErrorResult` (suitable for `return result` from a handler) when
 * the gate rejects the request, otherwise `null` to indicate passthrough.
 *
 * @param {object} args
 * @param {string} args.provider              Provider id (e.g. "openai")
 * @param {string} [args.canonicalModel]      Catalog-facing model id (alias)
 * @param {string} [args.upstreamModel]       Provider-facing model id
 * @param {{ warn?: (tag: string, message: string) => unknown }} [args.log]
 * @param {Date | number | string} [args.asOf]
 * @returns {ReturnType<typeof createErrorResult> | null}
 */import { isString } from "@/shared/utils/typeChecks.js";
export function checkModelLifecycle({ provider, canonicalModel, upstreamModel, log, asOf = Date.now() } = {}) {
  const candidates = [];
  if (isString(canonicalModel) && canonicalModel) {
    candidates.push(canonicalModel);
  }
  if (
  isString(upstreamModel) &&
  upstreamModel &&
  upstreamModel !== canonicalModel)
  {
    candidates.push(upstreamModel);
  }

  for (const candidate of candidates) {
    const decision = getModelLifecycleDecision(provider, candidate, asOf);
    const message = formatModelLifecycleMessage(decision);
    if (decision.action === "warn" && message) {
      log?.warn?.("MODEL_LIFECYCLE", message);
      continue;
    }
    if (decision.action !== "reject" || !message) continue;
    return createErrorResult(
      HTTP_STATUS.GONE,
      message,
      null,
      { error: { type: "invalid_request_error", code: "model_shutdown", message } }
    );
  }
  return null;
}