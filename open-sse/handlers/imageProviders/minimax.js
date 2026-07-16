// MiniMax Text-to-Image adapter.
// Ported from OmniRoute PR #7108 (head 483080bfc8e2, upstream issue #2482).
// MiniMax's image_generation endpoint is synchronous (unlike its video/music
// endpoints, which are task-based and polled) and returns image URLs directly
// in `data.image_urls`. This normalizes that response into the OpenAI-compatible
// images payload. It is NOT OpenAI-compatible, so it cannot use the generic
// createOpenAIAdapter: the request body uses `aspect_ratio` (not `size`) and the
// response nests URLs under `data.image_urls` (not `data[].url`).
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["minimax"]?.imageConfig?.baseUrl;

const MINIMAX_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);

// MiniMax accepts aspect-ratio strings ("16:9") rather than pixel sizes; an
// unsupported size (e.g. "1024x1024") falls back to "1:1".
function mapMinimaxAspectRatio(size) {
  if (size && MINIMAX_ASPECT_RATIOS.has(size)) return size;
  return "1:1";
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
  buildBody: (model, body) => ({
    model: model || "image-01",
    prompt: body.prompt,
    aspect_ratio: mapMinimaxAspectRatio(body.size),
    n: body.n ?? 1,
    response_format: "url",
  }),
  // MiniMax can return HTTP 200 with zero images (e.g. content filtered); the
  // source treats that as a 502 upstream failure, not a successful empty list.
  // Throwing here routes through the core's parse-error path -> 502.
  parseResponse: async (providerResponse) => {
    const data = await providerResponse.json();
    const urls = Array.isArray(data?.data?.image_urls) ? data.data.image_urls : [];
    if (urls.length === 0) {
      throw new Error(data?.base_resp?.status_msg || "No images returned from MiniMax");
    }
    return data;
  },
  normalize: (responseBody, prompt) => {
    const urls = Array.isArray(responseBody?.data?.image_urls) ? responseBody.data.image_urls : [];
    return {
      created: nowSec(),
      data: urls.map((url) => ({ url, revised_prompt: prompt })),
    };
  },
};
