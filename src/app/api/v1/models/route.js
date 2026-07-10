import { LLM_KIND, buildModelsList } from "./buildModelsList.js";
import { buildModelsResponse } from "./_shared.js";
import { headOkResponse } from "open-sse/translator/validate.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request) {
  try {
    const data = await buildModelsList([LLM_KIND]);
    return buildModelsResponse(request, data);
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}

/**
 * HEAD /v1/models (OmniRoute #6608 / #6517).
 *
 * Returns 200 with a null body immediately. Next 16 would otherwise auto-derive
 * HEAD from GET and stream the full model list (~hundreds of KB); SDK health
 * probes then hang ~6s waiting for the body RFC 9110 §9.3.2 says must be empty.
 */
export async function HEAD() {
  return headOkResponse();
}
