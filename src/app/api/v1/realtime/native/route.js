import { getSettings } from "@/lib/localDb";
import { enforceApiKeyModelPolicy } from "@/sse/services/apiKeyPolicy";
import { isNativeTerminalUsageEvent, nativeUsageAdmission, nativeUsageFromValue, recordNativeUsage } from "@/sse/services/nativeUsage.js";
import { getProviderCredentialsWithQuotaPreflight, resolveClientApiKey } from "@/sse/services/auth";
import { getModelInfo } from "@/sse/services/model";
import { getModelQuotaFamily, getModelUpstreamId, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels";
import REGISTRY from "open-sse/providers/registry/index.js";
import { verifyControlProof, verifyRealtimeOperatorProof } from "../../../../../mitm/controlProof.js";
import handoff from "open-sse/handlers/nativeRealtimeHandoff.cjs";
import { NATIVE_WEBSOCKETS } from "@/sse/handlers/nativeProviderConfig.js";
import { resolveWebSocketProxyRoute } from "open-sse/utils/proxyFetch.js";
import { isString } from "@/shared/utils/typeChecks.js";

const PATHNAME = "/api/v1/realtime/native";
const LOCAL_PATHS = { realtime: "/v1/realtime", realtimeTranslation: "/v1/realtime/translations", realtimeTranscription: "/v1/realtime", live: "/v1/live/sessions" };

function response(status, body = null) {
  return new Response(body, { status, headers: { "Cache-Control": "no-store" } });
}
function controlRequestVerified(request) {
  const port = request.headers.get("x-9r-owner-port");
  return /^\d{1,5}$/.test(port || "") && verifyControlProof({ method: "POST", pathname: PATHNAME, remotePort: Number(port), proof: request.headers.get("x-9r-owner-proof") });
}
function clientRequest(request) {
  const key = request.headers.get("x-9r-realtime-client-key");
  return new Request("http://127.0.0.1/v1/realtime", { headers: key ? { Authorization: `Bearer ${key}` } : undefined });
}

export async function POST(request) {
  if (!controlRequestVerified(request)) return response(404, "Not Found");
  let body;
  try { body = await request.json(); } catch { return response(400, "Bad Request"); }
  const modelString = isString(body?.model) ? body.model : "";
  if (!modelString) return response(400, "Bad Request");

  const authRequest = clientRequest(request);
  const settings = await getSettings();
  const operator = verifyRealtimeOperatorProof({ proof: request.headers.get("x-9r-realtime-operator-proof"), model: modelString, path: body.path, expiresAt: body.operatorExpiresAt });
  const { apiKey, auth } = await resolveClientApiKey(authRequest, { required: settings.requireApiKey === true });
  if (!auth.ok && !operator) return response(401, "Unauthorized");
  // Bind every turn and close callback to admission, never the current generation.
  const billingEpoch = auth.billingEpoch;
  const { provider, model } = await getModelInfo(modelString);
  if (!provider || !model) return response(400, "Bad Request");
  const canonicalIdentity = `${provider}/${model}`;
  const entry = REGISTRY.find((candidate) => candidate.id === provider || candidate.alias === provider);
  if (isString(body.authorizeModel) && body.authorizeModel) {
    const requested = body.authorizeModel.includes("/") ? body.authorizeModel : `${provider}/${body.authorizeModel}`;
    const resolved = await getModelInfo(requested);
    if (resolved.provider !== provider || !resolved.model) return response(403, "Forbidden");
    const denied = operator ? null : await enforceApiKeyModelPolicy(authRequest, `${provider}/${resolved.model}`, apiKey, { limits: false });
    return denied ? response(denied.status, "Forbidden") : response(204);
  }
  const policyFailure = operator ? null : await enforceApiKeyModelPolicy(authRequest, canonicalIdentity, apiKey);
  if (policyFailure) return response(policyFailure.status, "Forbidden");
  if (!operator) {
    const dailyError = await nativeUsageAdmission(apiKey);
    if (dailyError) return dailyError;
  }
  const catalogModel = entry?.models?.find((candidate) => candidate.id === model || candidate.aliases?.includes(model));
  const kind = catalogModel?.kind || catalogModel?.type;
  let protocol = entry?.realtimeConfig?.protocols?.[kind] || (kind === "realtime" ? { ...entry?.realtimeConfig, modelInQuery: true } : null);
  const nativePrefix = `/v1/native/${provider}`;
  const nativeProtocol = isString(body.path) && body.path.startsWith(`${nativePrefix}/`) ?
    NATIVE_WEBSOCKETS[provider]?.[body.path.slice(nativePrefix.length)] : null;
  if (nativeProtocol) {
    if (nativeProtocol.kind !== kind) return response(400, "Bad Request");
    protocol = nativeProtocol;
  } else {
    if (!protocol?.wsUrl) return body.path === "/v1/realtime" && (!kind || kind === "llm") ? response(204) : response(400, "Bad Request");
    if (body.path !== LOCAL_PATHS[kind]) return response(400, "Bad Request");
  }
  const connectionId = isString(body.connectionId) && body.connectionId ? body.connectionId : null;
  if (body.connectionId != null && (!isString(body.connectionId) || !body.connectionId)) return response(400, "Bad Request");

  const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const credentials = await getProviderCredentialsWithQuotaPreflight(provider, null, model, {
    apiKeyId: auth.apiKeyId,
    modelCandidates: [model, getModelUpstreamId(providerAlias, model)],
    quotaFamily: getModelQuotaFamily(providerAlias, model),
    preferredConnectionId: connectionId,
    strictConnectionId: connectionId
  });
  if (credentials?.allRateLimited || credentials?.providerDisabled) return response(503, "Provider unavailable");
  if (connectionId && credentials?.connectionId !== connectionId) return response(403, "Forbidden");
  if (!credentials?.connectionId) return response(503, "Provider unavailable");
  const secret = credentials?.apiKey || credentials?.accessToken;
  if (!secret) return response(503, "Provider unavailable");
  const endpoint = new URL(protocol.wsUrl);
  const upstreamModel = getModelUpstreamId(providerAlias, model);
  if (protocol.queryAuth) endpoint.searchParams.set(protocol.queryAuth, secret);
  if (protocol.modelInQuery === true && !protocol.omitModelIds?.includes(upstreamModel)) endpoint.searchParams.set("model", upstreamModel);
  for (const [name, value] of body.query || []) {
    if (protocol.queryParameters?.includes(name)) endpoint.searchParams.append(name, value);
  }
  let proxy;
  try { proxy = resolveWebSocketProxyRoute(endpoint.toString(), credentials.providerSpecificData); }
  catch { return response(503, "Configured egress does not support native WebSocket transport"); }
  const usageSessionId = crypto.randomUUID();
  const accounting = {
    apiKey, billingEpoch, provider, model, connectionId: credentials.connectionId, endpoint: body.path,
    modality: kind, nativeUnits: {}, cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable",
  };
  const committedResponses = new Set();
  let geminiTurn = 1;
  let geminiObservedUsage = null;
  let geminiSettling = Promise.resolve(true);
  // Gemini reports cumulative turn usage. Commit only at completion or close,
  // preserving all components and invalid values for strict ledger validation.
  const settleGeminiUsage = () => geminiSettling = geminiSettling.then(async () => {
    let allowed = true;
    if (geminiObservedUsage) {
      allowed = await recordNativeUsage({ ...accounting, tokens: geminiObservedUsage,
        usageEventId: `${provider}:${credentials.connectionId}:${usageSessionId}:turn:${geminiTurn}` });
      geminiObservedUsage = null;
      geminiTurn++;
    }
    return allowed;
  });
  const handoffId = handoff.createNativeRealtimeHandoff({
    wsUrl: endpoint.toString(), authorization: protocol.queryAuth ? null : `${entry.realtimeConfig?.authScheme || "Bearer"} ${secret}`,
    queryAuthParameter: protocol.queryAuth || null, sessionType: protocol.sessionType || null,
    transcriptionModel: protocol.sessionType === "transcription" ? upstreamModel : null, binaryAudio: protocol.binaryAudio === true,
    geminiLive: protocol.geminiLive === true, pinnedModel: protocol.geminiLive === true ? upstreamModel : null, proxy,
    onProviderEvent: async (event) => {
      if (protocol.geminiLive) {
        const observed = nativeUsageFromValue(event);
        if (observed) geminiObservedUsage = observed;
        return event?.serverContent?.turnComplete ? settleGeminiUsage() : true;
      }
      if (!isNativeTerminalUsageEvent(event) || !nativeUsageFromValue(event)) return true;
      // Transport/session events are not billable responses. Never use session IDs.
      const responseId = event?.response?.id || event?.response_id ||
        (event?.type === "conversation.item.input_audio_transcription.completed" ? event.item_id : null);
      if (!responseId) throw new TypeError("Native realtime usage requires a billable response ID");
      const usageEventId = `${provider}:${credentials.connectionId}:${responseId}:terminal`;
      if (committedResponses.has(usageEventId)) return true;
      const allowed = await recordNativeUsage({ ...accounting, value: event, usageEventId });
      committedResponses.add(usageEventId);
      return allowed;
    },
    onProviderClose: protocol.geminiLive ? settleGeminiUsage : null
  });
  return Response.json({ handoffId }, { headers: { "Cache-Control": "no-store" } });
}
