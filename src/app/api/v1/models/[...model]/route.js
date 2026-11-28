import { addAutoModelSelectors } from "@/shared/utils/autoModelSelectors.js";
import { corsHeaders } from "@/lib/http/cors.js";
import { withRequestCorrelation, withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { LLM_KIND, buildModelsList } from "../buildModelsList.js";
import { buildModelsResponse } from "../_shared.js";
import { headOkResponse, headNotFoundResponse } from "open-sse/translator/validate.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";
import { filterModelsForRequest, getRequestModelDiscoveryOptions } from "@/sse/services/modelAccess.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
  "rerank": ["rerank"],
  "video": ["video"],
  "music": ["music"],
  "realtime": ["realtime"],
  "moderation": ["moderation"],
  "audio": ["audio"],
  "realtime-translation": ["realtimeTranslation"],
  "realtime-transcription": ["realtimeTranscription"],
  "live": ["live"],
  "systemone": ["systemone"],
  "document-parsing": ["documentParsing"],
};

const CORS_HEADERS = { ...corsHeaders(["GET", "HEAD", "OPTIONS"]) };

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...init.headers },
  });
}

function unknownKindResponse(kind) {
  return json(
    {
      error: {
        message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}`,
        type: "invalid_request_error",
      },
    },
    { status: 404 },
  );
}

function modelNotFoundResponse(model) {
  return json(
    {
      error: {
        message: `The model '${model}' does not exist or you do not have access to it.`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    },
    { status: 404 },
  );
}

// A static registry check: it needs no database, so a mistyped kind stays cheap.
function isRegistryModelId(id) {
  return Object.values(PROVIDER_MODELS).some((models) => models.some((model) => model.id === id));
}

/** Exact id first, then the id without its provider prefix (9router #3871). */
function findCatalogModel(models, identifier) {
  return models.find((candidate) => candidate.id === identifier) ||
    (identifier.includes("/") ? undefined :
      models.find((candidate) => candidate.id.slice(candidate.id.indexOf("/") + 1) === identifier));
}

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...corsHeaders(["GET", "HEAD", "OPTIONS"]),
    },
  });
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * GET /v1/models/{provider}/{model} - exact configured LLM model lookup.
 * GET /v1/models/{model} - a registry model id without its provider prefix.
 *
 * A single segment that is neither a kind nor a registry model id deliberately
 * retains the legacy `Unknown model kind` response. Other misses use OpenAI's
 * `model_not_found` contract.
 */
async function GETHandler(request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;

    if (kindFilter) {
      const models = await filterModelsForRequest(request, await buildModelsList(kindFilter, getProviderValidationGuard(), await getRequestModelDiscoveryOptions(request)));
      const data = await filterModelsForRequest(request, kindFilter.length === 1 ? addAutoModelSelectors(models, kindFilter[0]) : models);
      return buildModelsResponse(request, data);
    }

    // Preserve the one-segment capability-route compatibility contract. A
    // decoded slash still identifies a provider-prefixed model lookup.
    if (path.length === 1 && !identifier.includes("/") && !isRegistryModelId(identifier)) {
      return unknownKindResponse(identifier);
    }

    const models = await filterModelsForRequest(request, await buildModelsList([LLM_KIND], getProviderValidationGuard(), await getRequestModelDiscoveryOptions(request)));
    const matchedModel = findCatalogModel(models, identifier);
    return matchedModel ? json(matchedModel) : modelNotFoundResponse(identifier);
  } catch (error) {
    console.log("Error fetching model:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}

/**
 * HEAD stays catalog-free: known kinds, registry model ids, and provider-prefixed
 * lookup paths are routable; unknown legacy one-segment kinds remain 404.
 */
async function HEADHandler(_request, { params }) {
  const { model } = await params;
  const path = Array.isArray(model) ? model : [model];
  const identifier = path.filter(Boolean).join("/");
  if (KIND_SLUG_MAP[identifier] || path.length > 1 || identifier.includes("/") || isRegistryModelId(identifier)) {
    return headOkResponse();
  }
  return headNotFoundResponse();
}

export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withHttpRequestCorrelation(GETHandler);
export const HEAD = withHttpRequestCorrelation(HEADHandler);
