// RenderHour (renderhour.com): image, video and speech jobs with an `rh_` API
// key or a subscription OAuth sign-in. Registered for #2034 (1127): images run
// through the shared image core, video through /v1/video/generations and speech
// through /v1/audio/speech. See docs/providers/renderhour.md.
//
// Origin, endpoints and the image, video and speech model ids come from
// cheaper-inference/OmniRoute at 9671192011beb2d7f83979f40be488c5da8772b9 (MIT,
// Copyright (c) 2026 Cheaper Inference - Created by Diego Souza):
// open-sse/config/providers/registry/renderhour/mediaModels.ts.
//
// The pinned source also declares a subscription OAuth sign-in
// (src/lib/oauth/providers/renderhour.ts and
// services/tokenRefresh/providers/renderhour.ts); its protocol lives in
// services/renderhour/oauth.js. There is no chat transport.

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

const VIDEO_MODELS = [
  ["seedance-2.5", "Seedance 2.5"],
  ["seedance-2.0", "Seedance 2.0"],
  ["seedance-2.0-fast", "Seedance 2.0 Fast"],
  ["seedance-2.0-mini", "Seedance 2.0 Mini"],
  ["kling-3.0", "Kling 3.0"],
  ["kling-3.0-turbo", "Kling 3.0 Turbo"],
  ["veo-3.1", "Google Veo 3.1"],
  ["grok-imagine-video-1.5", "Grok Imagine 1.5"],
  ["grok-imagine-video-1.5-lite", "Grok Imagine 1.5 Lite"],
  ["happyhorse-1.1", "HappyHorse 1.1"],
  ["gemini-omni-flash", "Gemini Omni Flash"],
  ["flux-3-video", "FLUX.3 Video"],
  ["flux-3-max", "FLUX 3 Max"],
  ["wan-3.0", "Wan 3.0"],
  ["minimax-h3", "MiniMax H3"],
  ["hailuo-2.3", "MiniMax Hailuo 2.3"],
];

const SPEECH_MODELS = [
  ["eleven-v4", "ElevenLabs v4"],
  ["eleven-v4-turbo", "ElevenLabs v4 Turbo"],
  ["minimax-speech-2.8-hd", "MiniMax Speech 2.8 HD"],
];

export const RENDERHOUR_VIDEO_MODEL_IDS = Object.freeze(VIDEO_MODELS.map(([id]) => id));
export const RENDERHOUR_SPEECH_MODEL_IDS = Object.freeze(SPEECH_MODELS.map(([id]) => id));

// Task -> model ids. A model id belongs to exactly one task.
export const RENDERHOUR_MODELS_BY_TASK = Object.freeze({
  image: RENDERHOUR_IMAGE_MODEL_IDS,
  video: RENDERHOUR_VIDEO_MODEL_IDS,
  speech: RENDERHOUR_SPEECH_MODEL_IDS,
});

const TASK_OF_MODEL = new Map(
  Object.entries(RENDERHOUR_MODELS_BY_TASK).flatMap(([task, ids]) => ids.map((id) => [id, task]))
);

/** "image", "video", "speech", or null for an id RenderHour does not list. */
export function renderHourTaskOf(model) {
  return TASK_OF_MODEL.get(model) ?? null;
}

const entries = (list, kind, params) => list.map(([id, name]) => ({ id, name, params, kind }));

// Every model, by kind. There is deliberately no videoConfig or ttsConfig: the
// shared /v1/videos job proxy and the config-driven speech formats do not fit a
// submit-and-poll job, so video runs through handlers/videoProviders and speech
// through handlers/ttsProviders instead.
export const RENDERHOUR_MEDIA = Object.freeze({
  serviceKinds: Object.freeze(["image", "video", "tts"]),
  models: Object.freeze([
    ...entries(MODELS, "image", ["size", "n"]),
    ...entries(VIDEO_MODELS, "video", ["duration", "aspect_ratio", "resolution"]),
    ...entries(SPEECH_MODELS, "tts", []),
  ]),
});

// The subscription sign-in. Source: src/lib/oauth/providers/renderhour.ts and
// open-sse/services/tokenRefresh/providers/renderhour.ts at the pinned commit.
export const RENDERHOUR_OAUTH = Object.freeze({
  authType: "oauth",
  flowType: "authorization_code_pkce",
  // Wired hooks. Paths are relative to the repository root.
  oauthHandler: "src/lib/oauth/services/renderhour.js#renderhourOAuthProvider",
  refreshHooks: "open-sse/services/renderhour/oauth.js#createRenderHourRefreshHooks",
  // Optional client override. The default public client lives in oauth.js.
  clientIdEnv: "RENDERHOUR_OAUTH_CLIENT_ID",
  // Same media tasks as an rh_ key, paid in plan credits (per the source).
  serviceKinds: Object.freeze(["image", "video", "tts"]),
});

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
      text: "Image, text-to-video and speech jobs with an rh_ API key, or a plan sign-in. Sign-in redirects to localhost; on a remote dashboard, paste the callback URL back. No reference images, image-to-video or voice choice. Images and video return file URLs only (response_format url). Cost is not reported.",
      apiKeyUrl: RENDERHOUR_ORIGIN,
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey", "oauth"],
  authHint: "An rh_ API key from renderhour.com, or sign in to a RenderHour plan (no setup needed; RENDERHOUR_OAUTH_CLIENT_ID optionally overrides the client).",
  transport: null,
  models: RENDERHOUR_MEDIA.models.map((model) => ({ ...model, params: [...model.params] })),
  serviceKinds: [...RENDERHOUR_MEDIA.serviceKinds],
  imageConfig: { baseUrl: RENDERHOUR_GENERATIONS_URL },
};
