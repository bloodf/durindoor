// DashScope native image generation for four existing Alibaba-family
// credential identities, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts, entries `alibaba` (alias "ali",
//   format "alibaba-image"), `qwen-cloud` ("qwc", "qwen-cloud-image"),
//   `qwen-cloud-token-plan` ("qct", "qwen-token-plan-image") and
//   `bailian-coding-plan` ("bcp", "bailian-coding-plan-image"): authType
//   "apikey", authHeader "bearer", the baseUrls, models and supportedSizes below;
// - open-sse/handlers/imageGeneration.ts: all four formats dispatch to
//   handleAlibabaImageGeneration;
// - open-sse/handlers/imageGeneration/providers/alibabaImage.ts: the
//   allowlist check, `apiKey || accessToken`, the multimodal-generation body
//   and the `output.choices[].message.content[].image` answer;
// - src/shared/constants/alibabaProviderRegions.ts: the global-sg media roots
//   (bailian-coding-plan media stays on coding-intl.dashscope.aliyuncs.com
//   through ALIBABA_PROVIDER_MEDIA_OVERRIDES although its chat moved hosts).
//
// Each identity is its own connection family with its own key and its own
// fixed origin; nothing here maps one identity's model, alias or host onto
// another's. Only the global-sg hosts pinned by the source registry are used.
import { ALIBABA_DASHSCOPE_INTL_ORIGIN } from "../../alibabaVideo/job.js";

export const DASHSCOPE_IMAGE_PATH = "/api/v1/services/aigc/multimodal-generation/generation";
export const DASHSCOPE_TOKEN_PLAN_INTL_ORIGIN = "https://token-plan.ap-southeast-1.maas.aliyuncs.com";
export const DASHSCOPE_CODING_INTL_ORIGIN = "https://coding-intl.dashscope.aliyuncs.com";
/** Source region value these fixed hosts belong to. */
export const DASHSCOPE_IMAGE_REGION = "global-sg";

const model = (id, name, images) => Object.freeze({ id, name, inputModalities: Object.freeze(images ? ["text", "image"] : ["text"]) });

const identity = ({ id, alias, format, origin, models, sizes }) => Object.freeze({
  id,
  alias,
  format,
  origin,
  url: `${origin}${DASHSCOPE_IMAGE_PATH}`,
  models: Object.freeze(models),
  supportedSizes: Object.freeze(sizes),
});

/** The four source registry entries, keyed by provider id. Model order is the source's. */
export const DASHSCOPE_IMAGE_IDENTITIES = Object.freeze({
  alibaba: identity({
    id: "alibaba",
    alias: "ali",
    format: "alibaba-image",
    origin: ALIBABA_DASHSCOPE_INTL_ORIGIN,
    models: [
      model("qwen-image-3.0-pro", "Qwen Image 3.0 Pro", true),
      model("qwen-image-2.0-pro-2026-06-22", "Qwen Image 2.0 Pro (2026-06-22)", true),
      model("qwen-image-2.0", "Qwen Image 2.0", true),
      model("z-image-turbo", "Z-Image Turbo", false),
      model("wan2.6-t2i", "Wan 2.6 T2I", false),
    ],
    sizes: ["1024x1024", "1280x1280", "2048x2048"],
  }),
  "qwen-cloud": identity({
    id: "qwen-cloud",
    alias: "qwc",
    format: "qwen-cloud-image",
    origin: ALIBABA_DASHSCOPE_INTL_ORIGIN,
    models: [
      model("wan2.7-image-pro", "Wan 2.7 Image Pro", true),
      model("wan2.7-image", "Wan 2.7 Image", true),
      model("qwen-image-3.0-pro", "Qwen Image 3.0 Pro", true),
      model("qwen-image-2.0-pro-2026-06-22", "Qwen Image 2.0 Pro (2026-06-22)", true),
      model("qwen-image-2.0-2026-03-03", "Qwen Image 2.0 (2026-03-03)", true),
      model("z-image-turbo", "Z-Image Turbo", false),
    ],
    sizes: ["1024x1024", "2048x2048"],
  }),
  "qwen-cloud-token-plan": identity({
    id: "qwen-cloud-token-plan",
    alias: "qct",
    format: "qwen-token-plan-image",
    origin: DASHSCOPE_TOKEN_PLAN_INTL_ORIGIN,
    models: [
      model("wan2.7-image", "Wan 2.7 Image", true),
      model("wan2.7-image-pro", "Wan 2.7 Image Pro", true),
    ],
    sizes: ["1024x1024", "2048x2048"],
  }),
  "bailian-coding-plan": identity({
    id: "bailian-coding-plan",
    alias: "bcp",
    format: "bailian-coding-plan-image",
    origin: DASHSCOPE_CODING_INTL_ORIGIN,
    models: [
      model("wan2.7-image", "Wan 2.7 Image", true),
      model("wan2.7-image-pro", "Wan 2.7 Image Pro", true),
      model("qwen-image-2.0", "Qwen Image 2.0", true),
      model("qwen-image-2.0-pro", "Qwen Image 2.0 Pro", true),
    ],
    sizes: ["1024x1024", "2048x2048"],
  }),
});

export const DASHSCOPE_IMAGE_PROVIDER_IDS = Object.freeze(Object.keys(DASHSCOPE_IMAGE_IDENTITIES));

/** Boolean parameters the source copies from the body into `parameters`. */
export const DASHSCOPE_BOOLEAN_PARAMETERS = Object.freeze(["prompt_extend", "watermark", "enable_sequential", "thinking_mode"]);

// Gateway bounds (not in the source).
export const DASHSCOPE_IMAGE_SUBMIT_TIMEOUT_MS = 180_000;
export const DASHSCOPE_IMAGE_TOTAL_TIMEOUT_MS = 240_000;
export const DASHSCOPE_IMAGE_RESPONSE_MAX_BYTES = 1024 * 1024;
export const DASHSCOPE_IMAGE_ERROR_MAX_BYTES = 16 * 1024;
export const DASHSCOPE_IMAGE_MAX_N = 10;
export const DASHSCOPE_IMAGE_MAX_RESULTS = 16;
export const DASHSCOPE_IMAGE_MAX_INPUT_IMAGES = 9;
export const DASHSCOPE_IMAGE_MAX_PROMPT_CHARS = 8192;
export const DASHSCOPE_IMAGE_MIN_SIDE = 64;
export const DASHSCOPE_IMAGE_MAX_SIDE = 8192;
export const DASHSCOPE_IMAGE_MAX_PALETTE = 16;
