import { withRequestCorrelation } from "@/sse/utils/requestCorrelation.js";
import { LLM_KIND, buildModelsList } from "../buildModelsList.js";
import { buildModelsResponse } from "../_shared.js";
import { headOkResponse, headNotFoundResponse } from "open-sse/translator/validate.js";
import { getProviderValidationGuard } from "open-sse/utils/outboundUrlGuard.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
  "rerank": ["rerank"],
};

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

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

async function OPTIONSHandler() {
  return new Response(null, {
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * GET /v1/models/{provider}/{model} - exact configured LLM model lookup.
 *
 * A single unknown segment deliberately retains the legacy `Unknown model kind`
 * response. Provider-prefixed misses use OpenAI's `model_not_found` contract.
 */
async function GETHandler(request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;

    if (kindFilter) {
      const data = await buildModelsList(kindFilter, getProviderValidationGuard());
      return buildModelsResponse(request, data);
    }

    // Preserve the one-segment capability-route compatibility contract. A
    // decoded slash still identifies a provider-prefixed model lookup.
    if (path.length === 1 && !identifier.includes("/")) {
      return unknownKindResponse(identifier);
    }

    const models = await buildModelsList([LLM_KIND], getProviderValidationGuard());
    const matchedModel = models.find((candidate) => candidate.id === identifier);
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
 * HEAD stays catalog-free: known kinds and provider-prefixed lookup paths are
 * routable; unknown legacy one-segment kinds remain 404.
 */
async function HEADHandler(_request, { params }) {
  const { model } = await params;
  const path = Array.isArray(model) ? model : [model];
  const identifier = path.filter(Boolean).join("/");
  if (KIND_SLUG_MAP[identifier] || path.length > 1 || identifier.includes("/")) {
    return headOkResponse();
  }
  return headNotFoundResponse();
}

export const OPTIONS = withRequestCorrelation(OPTIONSHandler);
export const GET = withRequestCorrelation(GETHandler);
export const HEAD = withRequestCorrelation(HEADHandler);
