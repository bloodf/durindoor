import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { headOkResponse, headNotFoundResponse } from "open-sse/translator/validate.js";
import { effectiveSyncedModels } from "@/lib/modelAutoSync/catalog.js";
import { loadModelMetadataSnapshot, materializeRequestModel } from "@/sse/services/model.js";
import { projectDiscoveryMetadata } from "open-sse/services/modelMetadata.js";
import { projectModelPresentation } from "open-sse/providers/models/presentation.js";

const KIND_ENDPOINT = {
  llm: "/v1/chat/completions",
  image: "/v1/images/generations",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions",
  webSearch: "/v1/search",
  webFetch: "/v1/fetch",
  rerank: "/v1/rerank",
  video: "/v1/videos",
  music: "/v1/music/generations",
  realtime: "/v1/realtime",
  moderation: "/v1/moderations",
  audio: "/v1/chat/completions",
  realtimeTranslation: "/v1/realtime/translations",
  realtimeTranscription: "/v1/realtime/transcription_sessions",
  live: "/v1/live/sessions",
};

const TTS_VOICES_API = new Set(["elevenlabs", "edge-tts", "deepgram", "inworld", "local-device", "minimax", "minimax-cn"]);

function buildInfo({ alias, providerId, model, kind, providerInfo, snapshot }) {
  const enriched = materializeRequestModel(providerId, { ...model, kind }, alias, snapshot);
  // Presentation is additive on /v1/models/info: keep the registry `name`
  // (or id fallback) and only attach the extra display fields.
  const presentation = projectModelPresentation({
    model,
    modelId: model.id,
    providerId,
    outputAlias: alias,
  });
  const out = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
    provider_name: presentation.provider_name,
    provider_alias: presentation.provider_alias,
    gateway_provider: presentation.gateway_provider,
    ...(model.routingUnavailableReason ? {
      endpoint: null,
      routingAvailable: false,
      routingUnavailableReason: model.routingUnavailableReason
    } : null),
  };
  if (model.params) out.params = model.params;
  out.capabilities = enriched.capabilities;
  // Image operation declarations are arrays, not numeric capability keys.
  if (Array.isArray(model.capabilities)) out.operations = model.capabilities;
  else if (Array.isArray(model.operations)) out.operations = model.operations;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  // Published limits come from the same scoped resolver as chat requests.
  // Never promote the generic runtime floor or a stale registry field.
  if (Number.isFinite(out.capabilities.contextWindow) && out.capabilities.contextWindow > 0) {
    out.contextWindow = out.capabilities.contextWindow;
  }
  if (Number.isFinite(out.capabilities.maxOutput) && out.capabilities.maxOutput > 0) {
    out.maxOutput = out.capabilities.maxOutput;
  }
  if (kind === "tts" && TTS_VOICES_API.has(providerId)) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig;
    if (cfg.searchTypes) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions) out.required = cfg.requiredOptions;
  }
  // The public info contract also exposes endpoint routing and camelCase
  // limits; the data-only discovery projection intentionally omits those.
  return { ...out, ...projectDiscoveryMetadata(out) };
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
async function lookup(fullId, requestedKind) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId];

  // Cached discovery enriches known rows and makes newly synced/custom models
  // inspectable. Shared metadata alone never grants a new callable model id.
  const staticModels = PROVIDER_MODELS[alias] || PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[providerId]] || PROVIDER_MODELS[providerId] || [];
  const snapshot = await loadModelMetadataSnapshot(providerId);
  const synced = effectiveSyncedModels(snapshot.syncedCatalogs[providerId], staticModels) || [];
  const registeredId = staticModels.find((entry) =>
    (entry.id === modelId || entry.aliases?.includes(modelId)) &&
    (!requestedKind || getModelKind(entry, "llm") === requestedKind)
  )?.id;
  const matches = (entry) => entry &&
    (entry.id === modelId || entry.id === registeredId || entry.aliases?.includes(modelId)) &&
    (!requestedKind || getModelKind(entry, "llm") === requestedKind);
  const registered = staticModels.find(matches);
  const live = synced.find((entry) => matches(entry) && (!registered || getModelKind(entry, "llm") === getModelKind(registered, "llm")));
  const selected = live || registered;
  const custom = snapshot.customModels.find((entry) =>
    entry && [alias, providerId, PROVIDER_ID_TO_ALIAS[providerId]].includes(entry.providerAlias) && matches(entry) &&
    (!selected || getModelKind(entry, "llm") === getModelKind(selected, "llm"))
  );
  if (registered || live || custom) {
    // Preserve params/routing declarations and the friendly registry name when
    // upstream echoes only its wire id. Operator names still win.
    const m = {
      ...registered,
      ...live,
      ...(Array.isArray(registered?.capabilities) ? { operations: registered.capabilities } : null),
      ...(custom ? { id: custom.id, kind: getModelKind(custom, "llm"), ...(custom.name ? { name: custom.name } : null) } : null),
      name: custom?.name || (live?.name && live.name !== modelId ? live.name : registered?.name) || live?.name || modelId,
    };
    const kind = getModelKind(m, "llm");
    return buildInfo({ alias, providerId, model: m, kind, providerInfo, snapshot });
  }

  // Web search/fetch — virtual model id "search" / "fetch"
  if (modelId === "search" && providerInfo?.searchConfig) {
    return buildInfo({
      alias, providerId, kind: "webSearch", providerInfo, snapshot,
      model: { id: "search", name: `${providerInfo.name} Search`, params: ["query", "max_results", "country", "language", "time_range", "domain_filter", "search_type"] },
    });
  }
  if (modelId === "fetch" && providerInfo?.fetchConfig) {
    return buildInfo({
      alias, providerId, kind: "webFetch", providerInfo, snapshot,
      model: { id: "fetch", name: `${providerInfo.name} Fetch`, params: ["url", "format", "max_characters"] },
    });
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" },
  });
}

/**
 * HEAD /v1/models/info — mirrors GET status with a null body.
 * Missing `id` → 400 (matches GET); unknown id → 404; known → 200.
 */
export async function HEAD(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return new Response(null, {
      status: 400,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  const info = await lookup(id, kind);
  if (!info) return headNotFoundResponse();
  return headOkResponse();
}

// GET /v1/models/info?id={alias}/{modelId} — metadata for a single model
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) {
    return Response.json(
      { error: { message: "Missing required query param: id (e.g. ?id=openai/dall-e-3)", type: "invalid_request_error" } },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const info = await lookup(id, kind);
  if (!info) {
    return Response.json(
      { error: { message: `Model not found: ${id}`, type: "not_found" } },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  return Response.json(info, { headers: { "Access-Control-Allow-Origin": "*" } });
}
