// MiniMax Text-to-Image adapter.
// Ported from OmniRoute PR #7108 (head 483080bfc8e2, upstream issue #2482).
// MiniMax's image_generation endpoint is synchronous (unlike its video/music
// endpoints, which are task-based and polled) and returns image URLs directly
// in `data.image_urls`. This normalizes that response into the OpenAI-compatible
// images payload. It is NOT OpenAI-compatible, so it cannot use the generic
// createOpenAIAdapter: the request body uses `aspect_ratio` (not `size`) and the
// response nests URLs under `data.image_urls` (not `data[].url`).
import { nowSec, sizeToAspectRatio } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["minimax"]?.imageConfig?.baseUrl;

// MiniMax aspect_ratio enum (per official image_generation spec) includes the
// ultrawide "21:9". A direct native ratio is honored as-is.
const MINIMAX_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"]);

// MiniMax accepts aspect-ratio strings ("16:9") rather than pixel sizes. A
// native ratio passes through; an OpenAI pixel size ("1792x1024") is mapped via
// the shared sizeToAspectRatio; anything unrecognized falls back to "1:1".
function mapMinimaxAspectRatio(size) {
  if (size && MINIMAX_ASPECT_RATIOS.has(size)) return size;
  return sizeToAspectRatio(size);
}

// MiniMax status_code 1026 = "Sensitive content detected in prompt" — a
// per-request content rejection, NOT an account/auth/quota failure. Surfacing
// it as a 4xx client error prevents imageGeneration's markAccountUnavailable
// from locking the account over a single filtered prompt.
const CONTENT_FILTERED = 1026;

// Error marker prefix checked by checkFallbackError so a per-request content
// rejection never triggers the account-fallback cooldown chain.
export const REQUEST_REJECTED = "provider_request_rejected";

function contentRejectedError(msg) {
  const err = new Error(`${REQUEST_REJECTED}: ${msg || "prompt rejected by MiniMax content filter"}`);
  err.status = 422;
  return err;
}

export default {
  buildUrl: () => BASE_URL,
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken || "";
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    };
  },
  buildBody: (model, body) => {
    // Honor a client-requested response_format, but only the values MiniMax
    // actually supports (url | base64); default to url.
    const requested = body.response_format === "base64" ? "base64" : "url";
    return {
      model: model || "image-01",
      prompt: body.prompt,
      aspect_ratio: mapMinimaxAspectRatio(body.size),
      n: body.n ?? 1,
      response_format: requested,
    };
  },
  // MiniMax returns 200 even for content-filtered prompts, signalling via
  // base_resp.status_code 1026 and/or an empty image array. A 1026 (or an empty
  // result with failed_count>0) is a per-request content rejection -> 422, never
  // an account failure. Any other empty 2xx is a genuine upstream failure -> 502
  // via the core's parse-error path.
  parseResponse: async (providerResponse) => {
    const data = await providerResponse.json();
    const statusCode = Number(data?.base_resp?.status_code);
    const urls = Array.isArray(data?.data?.image_urls) ? data.data.image_urls : [];
    const b64s = Array.isArray(data?.data?.image_base64) ? data.data.image_base64 : [];
    if (statusCode === CONTENT_FILTERED) {
      throw contentRejectedError(data?.base_resp?.status_msg);
    }
    if (urls.length === 0 && b64s.length === 0) {
      if (Number(data?.metadata?.failed_count) > 0) {
        throw contentRejectedError(data?.base_resp?.status_msg);
      }
      throw new Error(data?.base_resp?.status_msg || "No images returned from MiniMax");
    }
    return data;
  },
  normalize: (responseBody, prompt) => {
    const urls = Array.isArray(responseBody?.data?.image_urls) ? responseBody.data.image_urls : [];
    const b64s = Array.isArray(responseBody?.data?.image_base64) ? responseBody.data.image_base64 : [];
    const data = b64s.length > 0
      ? b64s.map((b64_json) => ({ b64_json, revised_prompt: prompt }))
      : urls.map((url) => ({ url, revised_prompt: prompt }));
    return { created: nowSec(), data };
  },
};
