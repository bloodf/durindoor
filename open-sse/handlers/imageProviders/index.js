import { kieImageAdapter } from "../../services/providerParity/native-kie-video-image/index.js";
import { createMediaRegistry, lookupMediaAdapter } from "../mediaRegistry.js";
// Image provider adapter registry
import createOpenAIAdapter from "./openai.js";
import gemini from "./gemini.js";
import codex from "./codex.js";
import sdwebui from "./sdwebui.js";
import comfyui from "./comfyui.js";
import huggingface from "./huggingface.js";
import nanobanana from "./nanobanana.js";
import falAi from "./falAi.js";
import stabilityAi from "./stabilityAi.js";
import blackForestLabs from "./blackForestLabs.js";
import runwayml from "./runwayml.js";
import cloudflareAi from "./cloudflareAi.js";
import antigravity from "./antigravity.js";
import minimax from "./minimax.js";
import together from "./together.js";
import nvidia from "./nvidia.js";
import magnific from "./magnific.js";
import deepai from "./deepai.js";
import copilotM365 from "./copilotM365.js";
import renderhour from "./renderhour.js";
import adobeFireflyWeb from "./adobe-firefly-web.js";
import adobeFireflyApi from "./adobe-firefly-api.js";
import aihorde from "./aihorde.js";
import { agnesImageAdapter as agnes } from "../../services/providerParity/native-agnes-video-image/index.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

export const IMAGE_ADAPTERS = createMediaRegistry({
  kie: kieImageAdapter,
  openai: createOpenAIAdapter("openai"),
  // Dedicated adapter (OmniRoute #7108): MiniMax image_generation is not
  // OpenAI-compatible (aspect_ratio request, data.image_urls response).
  minimax,
  // Same API on the China host the registry declares.
  "minimax-cn": { ...minimax, buildUrl: () => PROVIDER_MEDIA["minimax-cn"]?.imageConfig?.baseUrl },
  openrouter: createOpenAIAdapter("openrouter"),
  "sensenova-intl": createOpenAIAdapter("sensenova-intl"),
  venice: createOpenAIAdapter("venice"),
  nan: createOpenAIAdapter("nan"),
  recraft: createOpenAIAdapter("recraft"),
  "vercel-ai-gateway": createOpenAIAdapter("vercel-ai-gateway"),
  uberllm: createOpenAIAdapter("uberllm"),
  together,
  nvidia,
  xai: createOpenAIAdapter("xai"),
  gemini,
  codex,
  sdwebui,
  comfyui,
  huggingface,
  nanobanana,
  antigravity,
  agy: antigravity,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
  magnific,
  deepai,
  "cloudflare-ai": cloudflareAi,
  // One chat turn plus a Designer artifact download; needs a native sign-in connection.
  "copilot-m365-web": copilotM365,
  // Async submit-and-poll jobs on fixed origins; file URLs only (#2034, 1127).
  renderhour,
  // Adobe Firefly Services API (operator S2S credential). Never the consumer
  // firefly.adobe.com web app: `adobe-firefly` and `firefly` stay unknown.
  "adobe-firefly-api": adobeFireflyApi,
  "adobe-firefly-web": adobeFireflyWeb,
  // Native AI Horde image jobs on the existing `aihorde` provider: the selected
  // connection's key or the anonymous sentinel, `apikey` header, kudos never
  // priced. Chat stays on the registry's OpenAI facade transport.
  aihorde,
  horde: aihorde,
  // Native Agnes image generation on the existing `agnes` chat connection:
  // the selected key goes only to apihub.agnes-ai.com; `size` is required.
  agnes,
});

export function getImageAdapter(provider) {
  return lookupMediaAdapter(IMAGE_ADAPTERS, provider);
}

export function isImageProvider(provider) {
  return provider in IMAGE_ADAPTERS;
}
