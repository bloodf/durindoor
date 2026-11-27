// RenderHour (renderhour.com), image generation only. STAGED: nothing in the
// registry or the image adapter map imports this module yet, so it is
// unavailable to users. See docs/providers/renderhour.md.
//
// Origin, endpoints and image model ids come from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/config/providers/registry/renderhour/mediaModels.ts.
//
// The pinned source also declares video, speech and a subscription OAuth
// sign-in. None of those are declared here, and there is no chat transport.

export const RENDERHOUR_ID = "renderhour";
export const RENDERHOUR_ORIGIN = "https://renderhour.com";

// The only destinations the API key is sent to. Connection settings cannot change them.
export const RENDERHOUR_GENERATIONS_URL = `${RENDERHOUR_ORIGIN}/v1/generations`;

const MODELS = [
  ["nano-banana-pro", "Nano Banana Pro"],
  ["nano-banana-2.1", "Nano Banana 2.1"],
  ["nano-banana-2", "Nano Banana 2"],
  ["gpt-image-2", "GPT Image 2"],
  ["seedream-5.0-pro", "Seedream 5.0 Pro"],
  ["seedream-5.0-flash", "Seedream 5.0 Flash"],
  ["flux-3-image", "FLUX 3 Image"],
  ["flux-2-pro", "FLUX.2 Pro"],
  ["grok-imagine-image-2.0", "Grok Imagine 2.0"],
  ["z-image", "Z-Image"],
  ["recraft-v4.1", "Recraft V4.1"],
];

export const RENDERHOUR_IMAGE_MODEL_IDS = Object.freeze(MODELS.map(([id]) => id));

export default {
  id: RENDERHOUR_ID,
  alias: RENDERHOUR_ID,
  uiAlias: RENDERHOUR_ID,
  display: {
    name: "RenderHour",
    icon: "image",
    color: "#475569",
    textIcon: "RH",
    website: RENDERHOUR_ORIGIN,
    notice: {
      text: "Image generation only, with an rh_ API key. Requests poll until the job finishes (up to 5 minutes).",
      apiKeyUrl: RENDERHOUR_ORIGIN,
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: MODELS.map(([id, name]) => ({ id, name, params: ["size", "n"], kind: "image" })),
  serviceKinds: ["image"],
  imageConfig: { baseUrl: RENDERHOUR_GENERATIONS_URL },
};
