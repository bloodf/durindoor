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
import magnific from "./magnific.js";
import deepai from "./deepai.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const ADAPTERS = {
  openai: createOpenAIAdapter("openai"),
  // Dedicated adapter (OmniRoute #7108): MiniMax image_generation is not
  // OpenAI-compatible (aspect_ratio request, data.image_urls response).
  minimax,
  // Same API on the China host the registry declares.
  "minimax-cn": { ...minimax, buildUrl: () => PROVIDER_MEDIA["minimax-cn"]?.imageConfig?.baseUrl },
  openrouter: createOpenAIAdapter("openrouter"),
  venice: createOpenAIAdapter("venice"),
  recraft: createOpenAIAdapter("recraft"),
  "vercel-ai-gateway": createOpenAIAdapter("vercel-ai-gateway"),
  together,
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
};

export function getImageAdapter(provider) {
  return ADAPTERS[provider] || null;
}

export function isImageProvider(provider) {
  return provider in ADAPTERS;
}
