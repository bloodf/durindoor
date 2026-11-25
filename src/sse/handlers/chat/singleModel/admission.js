import { getProviderConnections, getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { getModelInfo, loadCustomCapabilities, parseModel } from "../../../services/model.js";
import { applyVisionBridgeReroute } from "open-sse/services/model.js";
import { resolveClientSessionId } from "open-sse/utils/sessionManager.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { errorResponse } from "open-sse/utils/error.js";
import { getFusionRequiredInput, comboPolicyRejection } from "open-sse/services/combo.js";
import { enforceApiKeyModelPolicy } from "../../../services/apiKeyPolicy.js";
import { modelKindError } from "../../modelKind.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import * as log from "../../../utils/logger.js";
import { terminal, proceed } from "./context.js";
import { effectiveLeafCapabilities } from "./providerHooks.js";

/**
 * Strip reasoning_content from assistant messages in conversation history.
 * Some providers (e.g. Mistral) reject requests containing reasoning_content
 * in assistant messages with "extra_forbidden" validation errors.
 * This field is only meaningful in streaming responses, not in request bodies.
 */
function stripReasoningFromMessages(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  let modified = false;
  for (const msg of body.messages) {
    if (msg && msg.role === "assistant" && msg.reasoning_content !== undefined) {
      delete msg.reasoning_content;
      modified = true;
    }
  }
  return modified ? { ...body, messages: [...body.messages] } : body;
}

/**
 * Fix message ordering for providers that require specific role sequences.
 * Mistral requires the last message to be user/tool (or assistant with prefix=true).
 * If the last message is an assistant without prefix, add prefix: true so the
 * provider can continue generation from that point.
 */
function fixMessageOrdering(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && !last.prefix) {
    last.prefix = true;
  }
}

async function buildSingleModelCapabilitiesMap(modelStr) {
  const resolved = await getModelInfo(modelStr);
  if (!resolved?.provider || !resolved?.model) return null;
  const requestPrefix = parseModel(modelStr).providerAlias || null;
  const caps = await loadCustomCapabilities(resolved.provider, resolved.model, requestPrefix);
  return caps;
}

/**
 * Vision Bridge (#6640): after policy passes, resolve custom capabilities and
 * reroute vision requests to the configured vision-capable model. Denied
 * requests never reach this DB lookup. Combo members resolve their own caps
 * upstream; this branch is only for single-model requests.
 * Returns { reroute } when the request must be re-run against the target.
 */
async function applyVisionBridge(ctx) {
  const { settings, request, apiKey, modelStr, body, privatePlan } = ctx;
  if (privatePlan || !ctx.allowVisionBridge || settings?.visionBridgeEnabled !== true || ctx.modelCapabilities !== undefined) return proceed();
  const singleModelCaps = await buildSingleModelCapabilitiesMap(modelStr);
  const visionTargetCaps = settings?.visionBridgeModel ?
  await buildSingleModelCapabilitiesMap(String(settings.visionBridgeModel)) :
  null;
  const vb = applyVisionBridgeReroute({ body, modelStr, settings, capabilities: singleModelCaps, targetCapabilities: visionTargetCaps });
  if (vb.rerouted) {
    const policyError = await enforceApiKeyModelPolicy(request, vb.modelStr, apiKey);
    if (policyError) {
      log.warn("CHAT", `Vision Bridge target "${vb.toModel}" denied by API key policy; keeping "${modelStr}"`);
    } else {
      log.info("CHAT", `Vision Bridge reroute: ${vb.fromModel} -> ${vb.toModel}`);
      // Re-resolve provider/model for the rerouted target; the caller recurses
      // into the pipeline with vision bridge disabled to prevent loops. The
      // body/model update is scoped to the recursive call so the original stays intact.
      const reroutedInfo = await getModelInfo(vb.modelStr);
      if (reroutedInfo?.provider) {
        return { kind: "reroute", body: vb.body, modelStr: vb.modelStr, visionTargetCaps };
      }
      // Invalid reroute target: fall through to original model.
    }
  }
  if (vb.toolOutputVision) {
    log.warn("CHAT", `Vision Bridge could not serve a tool-output image for "${modelStr}"`);
    return terminal(errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${modelStr}' cannot read images returned by a tool, and no permitted Vision Bridge target is available.`,
      { code: "capability_unavailable" }
    ));
  }
  ctx.modelCapabilities = singleModelCaps;
  return proceed();
}

/**
 * Pin the request to a specific connection when the client asks for one.
 * The header is preferred; body fields are accepted for backwards-compatible
 * clients but stripped before the core sees them.
 */
async function resolveConnectionPin(ctx) {
  const { provider, model, request, body, apiKeyId, privatePlan } = ctx;
  const rawConnectionPin = request.headers.get("x-connection-id") ||
  body.connectionId ||
  body.connection_id ||
  null;
  ctx.rawConnectionPin = rawConnectionPin;
  let preferredConnectionId = null;
  if (rawConnectionPin && !privatePlan) {
    const requestedId = String(rawConnectionPin);
    const canonicalProvider = resolveProviderId(provider);
    const scopedConnectionIds = apiKeyId ? await getApiKeyProviderConnectionIds(apiKeyId) : [];
    if (scopedConnectionIds.length > 0 && !scopedConnectionIds.includes(requestedId)) {
      log.warn("CHAT", `[${provider}/${model}] pinned connection ${requestedId.slice(0, 8)} not in scope for API key`);
      return terminal(errorResponse(HTTP_STATUS.BAD_REQUEST, "Requested connection is not available for this API key"));
    }
    const activeConnections = await getProviderConnections({ provider: canonicalProvider, isActive: true });
    const pinnedConnection = activeConnections.find((c) => c.id === requestedId);
    if (!pinnedConnection) {
      log.warn("CHAT", `x-connection-id not found for provider ${canonicalProvider}: ${requestedId.slice(0, 8)}`);
      return terminal(errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        `Connection ${requestedId.slice(0, 8)}... is not active for provider '${canonicalProvider}'.`
      ));
    }
    preferredConnectionId = pinnedConnection.id;
    log.info("CHAT", `[${provider}/${model}] pinned to connection ${preferredConnectionId.slice(0, 8)}`);
  }
  ctx.preferredConnectionId = preferredConnectionId;
  return proceed();
}

/** Normalize the upstream body: drop router-only pin fields and provider-hostile history. */
function sanitizeBody(ctx) {
  const { provider } = ctx;
  let { body } = ctx;
  // Strip router-only connection pin from upstream request body.
  if (body.connectionId !== undefined || body.connection_id !== undefined) {
    body = { ...body };
    delete body.connectionId;
    delete body.connection_id;
  }

  // Strip reasoning_content for providers that reject it (Mistral, etc.)
  // Preserve for providers that require it (DeepSeek thinking mode)
  if (!provider.startsWith("deepseek")) {
    body = stripReasoningFromMessages(body);
  }
  // Fix message ordering for all providers (prefix: true for last assistant)
  fixMessageOrdering(body.messages);
  ctx.body = body;
}

/**
 * Stage 2: policy and admission. Enforces the API-key model policy and model
 * kind, applies the Vision Bridge, resolves a connection pin, normalizes the
 * body, resolves request-scoped capabilities and rechecks Fusion inputs.
 * Nothing here selects a credential or touches an upstream.
 */
export async function admitRequest(ctx) {
  const { provider, model, request, apiKey, settings, modelStr } = ctx;

  // Enforce per-API-key model policy against the resolved underlying model when
  // the request started as a combo; the top-level combo name is not a model id.
  const policyError2 = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError2) return terminal(ctx.reportComboPolicyRejections && policyError2.status === HTTP_STATUS.FORBIDDEN ? comboPolicyRejection() : policyError2);

  // Mixed providers also expose speech and embedding models; reject declared
  // non-chat kinds before selecting an account, while allowing unknown IDs.
  const kindError = await modelKindError(provider, model, settings, "llm", ["llm", "imageToText", "audio"]);
  if (kindError) return terminal(kindError);

  const vision = await applyVisionBridge(ctx);
  if (vision.kind !== "ok") return vision;

  const pin = await resolveConnectionPin(ctx);
  if (pin.kind !== "ok") return pin;
  sanitizeBody(ctx);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  ctx.userAgent = request?.headers?.get("user-agent") || "";

  ctx.routingSessionId = resolveClientSessionId({
    headers: ctx.clientRawRequest?.headers,
    body: ctx.body,
    scope: provider
  });

  // Resolve request-scoped custom capabilities once, just before the retry loop.
  // Custom model aliases are stored by provider prefix; requestPrefix carries
  // the prefix the caller actually used (e.g. node alias or bare model alias).
  const parsed = parseModel(modelStr);
  const requestPrefix = parsed?.providerAlias || null;
  // The direct single-model path already resolved caps for the vision bridge;
  // reuse that result (undefined = not resolved yet). Combo attempts pass
  // undefined so each member resolves its own caps.
  ctx.resolvedModelCapabilities = ctx.modelCapabilities !== undefined ?
  ctx.modelCapabilities :
  await loadCustomCapabilities(provider, model, requestPrefix);

  // Recheck concrete leaves after alias/custom-capability resolution. Nested
  // combo capability unions are admission hints, not proof this leaf can read it.
  const fusionRequiredInput = getFusionRequiredInput(ctx.body);
  const effectiveFusionCapabilities = effectiveLeafCapabilities(provider, model, ctx.resolvedModelCapabilities);
  if (fusionRequiredInput.some((cap) => effectiveFusionCapabilities[cap] !== true)) {
    return terminal(new Response(
      JSON.stringify({ error: { message: `Fusion requires [${fusionRequiredInput.join(",")}] input support`, type: "invalid_request_error", code: "capability_unavailable" } }),
      { status: HTTP_STATUS.BAD_REQUEST, headers: { "Content-Type": "application/json" } }
    ));
  }
  return proceed();
}
