import { recordTokenSaverEvent } from "@/lib/usageDb";
import { createSingleModelContext, createLoopState } from "./singleModel/context.js";
import { resolveModel } from "./singleModel/resolveModel.js";
import { admitRequest } from "./singleModel/admission.js";
import { dispatchChatgptPlan } from "./singleModel/providerHooks.js";
import { selectCredentials, prepareAttempt } from "./singleModel/credentials.js";
import { dispatchAttempt } from "./singleModel/dispatch.js";
import { processAttemptResult } from "./singleModel/postProcess.js";

export { __resetAntigravity429StrikesForTests, warmRequestModelLimits } from "./singleModel/providerHooks.js";
export { isImageOnlyModel, isNonChatModel } from "./singleModel/resolveModel.js";
export { holdForEarlyEof } from "./singleModel/postProcess.js";

/**
 * Run the account loop: select credentials, dispatch, post-process, and repeat
 * until a response is final. Each stage returns a tagged outcome: "terminal"
 * ends the request with its response, "retry" starts the next iteration.
 */
async function runAccountLoop(ctx) {
  const state = await createLoopState(ctx);
  try {
    while (true) {
      const selection = await selectCredentials(ctx, state);
      if (selection.kind === "terminal") return selection.response;
      if (selection.kind === "retry") continue;

      const prepared = await prepareAttempt(ctx, state, selection.credentials);
      if (prepared.kind === "terminal") return prepared.response;
      if (prepared.kind === "retry") continue;

      const dispatched = await dispatchAttempt(ctx, state, prepared.attempt);
      if (dispatched.kind === "terminal") return dispatched.response;
      if (dispatched.kind === "retry") continue;

      const outcome = await processAttemptResult(ctx, state, prepared.attempt, dispatched.result);
      if (outcome.kind === "terminal") return outcome.response;
    }
  } finally {
    // Persist the latest routing attempt's event once per logical request.
    // Awaited so the row is durable before the response returns (fail-open
    // inside recordTokenSaverEvent — it catches DB errors and never throws).
    // Skip when a collector is in use; the owner persists after all attempts.
    if (state.lastTokenSaverEvent && !ctx.tokenSaverCollector) await recordTokenSaverEvent(state.lastTokenSaverEvent);
  }
}

/**
 * Stage pipeline for one single-model request: resolve the model, admit it
 * through policy, then either dispatch the ChatGPT plan or run the account loop.
 */
async function runSingleModelChat(ctx) {
  const resolved = await resolveModel(ctx);
  if (resolved.kind === "terminal") return resolved.response;

  const admitted = await admitRequest(ctx);
  if (admitted.kind === "terminal") return admitted.response;
  if (admitted.kind === "reroute") {
    // Recurse with vision bridge disabled to prevent loops.
    return handleSingleModelChat(
      admitted.body,
      admitted.modelStr,
      ctx.clientRawRequest,
      ctx.request,
      ctx.apiKey,
      ctx.attemptSignal,
      ctx.tokenSaverCollector,
      { settings: ctx.settings, planRequest: ctx.planRequest, allowVisionBridge: false, preResolvedCapabilities: admitted.visionTargetCaps, apiKeyName: ctx.apiKeyName, apiKeyId: ctx.apiKeyId, billingEpoch: ctx.billingEpoch }
    );
  }

  if (ctx.privatePlan) return dispatchChatgptPlan(ctx);
  return runAccountLoop(ctx);
}

/**
 * Handle single model chat request
 * Fusion and fallback with tool-output images use local policy markers
 * through nested attempts to classify all-candidate ACL denials. Nested combo
 * dispatch is supplied by the caller to keep routing dependencies one-way.
 *
 * Thin adapter over the stage pipeline in ./singleModel/: it packs the
 * positional parameters into one context object and runs the stages.
 */
export async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, attemptSignal = null, tokenSaverCollector = null, options = {}) {
  return runSingleModelChat(createSingleModelContext({ body, modelStr, clientRawRequest, request, apiKey, attemptSignal, tokenSaverCollector, options }));
}
