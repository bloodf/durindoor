// Native image upscale framework (POST /v1/images/upscale), staged and not
// registered (#2034). See ./registration.json for the route, auth, catalog,
// usage and discovery requirements of a later integration, and ./config.js
// for the pinned OmniRoute sources.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale.ts handleImageUpscale):
// parse `model` against the upscale registry, 400 for an unknown provider or
// model, then dispatch by the provider's format to its handler with the
// selected connection's credentials. getAllUpscaleModels lists every row
// under its provider id and alias as `{ id, name, provider, format }`.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { adobeFireflyUpscaleUnavailable } from "./adobeFirefly.js";
import { UPSCALE_PROVIDERS } from "./config.js";
import { resolveUpscaleModel } from "./request.js";
import { createStabilityUpscaleAdapter } from "./stability.js";
import { createSyntxUpscaleAdapter } from "./syntx.js";
import { createTopazUpscaleAdapter } from "./topaz.js";

/** Source getAllUpscaleModels: one row per provider id and alias. */
export function listImageUpscaleModels() {
  const rows = [];
  for (const config of Object.values(UPSCALE_PROVIDERS)) {
    for (const model of config.models) {
      for (const prefix of [config.id, ...config.aliases]) {
        rows.push({ id: `${prefix}/${model.id}`, name: model.name, provider: config.id, format: config.format });
      }
    }
  }
  return rows;
}

/** Capability row of a `provider/model` (factors, creativity, prompt), or null. */
export function describeImageUpscaleModel(raw) {
  try {
    const resolved = resolveUpscaleModel(raw);
    if (resolved.unavailable) return null;
    const { id, name, factors, supportsCreativity, supportsPrompt, promptRequired, description } = resolved.entry;
    return {
      id: `${resolved.provider}/${id}`, name, provider: resolved.provider, format: resolved.config.format, factors: [...factors],
      supportsCreativity: supportsCreativity === true, supportsPrompt: supportsPrompt === true, promptRequired: promptRequired === true, description,
    };
  } catch {
    return null;
  }
}

/**
 * @param {object} [options] - per-adapter test seams: { topaz, stability, syntx } option objects, or prebuilt `adapters`
 */
export function createImageUpscaleService(options = {}) {
  const adapters = options.adapters ?? {
    topaz: createTopazUpscaleAdapter(options.topaz),
    "stability-ai": createStabilityUpscaleAdapter(options.stability),
    syntx: createSyntxUpscaleAdapter(options.syntx),
  };
  return {
    adapters,
    listModels: listImageUpscaleModels,
    describeModel: describeImageUpscaleModel,
    /**
     * Run one upscale. `credentials` is the selected connection of the
     * resolved provider (for SYNTX the scoped `{ token }`); it is never sent
     * anywhere but that provider's own origin.
     * @returns {Promise<object>} `{ success: true, response, payload, accounting }`
     *   or an error result (`acceptedJob` when the vendor may have run and billed it,
     *   `unavailable` for the guarded Adobe Firefly rows)
     */
    async upscale({ body, credentials = null, signal = null, log } = {}) {
      if (!isRecord(body)) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Image upscale needs a JSON object body");
      let resolved;
      try {
        resolved = resolveUpscaleModel(body.model);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      if (resolved.unavailable) return adobeFireflyUpscaleUnavailable(resolved.unavailable);
      const adapter = adapters[resolved.provider];
      if (!adapter) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `No upscale adapter is configured for ${resolved.provider} (${resolved.config.format}) in this service`);
      return adapter.upscale({ model: resolved.model, body, credentials: credentials ?? {}, signal, log });
    },
  };
}

export { UPSCALE_PROVIDERS, ADOBE_FIREFLY_DISPOSITION } from "./config.js";
export { resolveUpscaleModel } from "./request.js";
export { adobeFireflyUpscaleUnavailable } from "./adobeFirefly.js";
export {
  collectUpscaleSourceImages, decodeInlineImage, extractUpscaleSourceImage, fetchRemoteImage, parsePublicHttpUrl, sniffUpscaleImage,
} from "./media.js";
export {
  buildTopazUpscaleForm, buildTopazUpscaleHeaders, createTopazUpscaleAdapter, parseTopazUpscaleRequest, resolveTopazUpscaleCredential, topazTargetSize,
} from "./topaz.js";
export {
  buildStabilityHeaders, buildStabilityUpscaleForm, createStabilityUpscaleAdapter, mapStabilityCreativity, parseStabilityUpscaleRequest,
  resolveStabilityUpscaleCredential,
} from "./stability.js";
export {
  collectSyntxCompletedMedia, createSyntxUpscaleAdapter, encodeSyntxUploadMultipart, extractSyntxImmediateUrls, parseSyntxUpscaleRequest,
  syntxAuthHeaders, syntxChatTitle, syntxScopedToken,
} from "./syntx.js";
