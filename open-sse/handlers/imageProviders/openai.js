// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

// OpenAI Images only accepts a compression percentage for JPEG and WebP.
// Forward it together with the normalized format so the request does not fall back to PNG.
function appendOpenAIImageOptions(full, body) {
  if (body.complexity !== undefined) full.complexity = body.complexity;
  if (body.output_compression === undefined) return;
  const format = typeof body.output_format === "string" ? body.output_format.trim().toLowerCase() : "";
  if (format === "jpeg" || format === "webp") {
    full.output_format = format;
    full.output_compression = body.output_compression;
  } else {
    delete full.output_compression;
  }
}

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: () => imageUrl(providerId),
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format, aspect_ratio, resolution, background, output_format, output_compression, moderation } = body;
      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;
      if (aspect_ratio) full.aspect_ratio = aspect_ratio;
      if (resolution) full.resolution = resolution;
      if (background) full.background = background;
      if (output_format) full.output_format = output_format;
      if (output_compression !== undefined) full.output_compression = output_compression;
      if (moderation) full.moderation = moderation;
      if (providerId === "openai") appendOpenAIImageOptions(full, body);
      // bodyFields whitelist applies only provider-supported native fields.
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}
