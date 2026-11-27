// Native image and video catalog ported from cheaper-inference/OmniRoute (MIT),
// c71f0065a7efe9230ec23b96a12253b050c4d7ad: open-sse/config/imageRegistryData.ts
// and open-sse/config/videoRegistry.ts (`agnes` entries). The native adapters
// send the selected key only to https://apihub.agnes-ai.com. There is no
// imageConfig: one would derive an /v1/images/edits passthrough the native
// adapter does not support. There is no videoConfig: /v1/videos has no
// accepted-job ledger. agnes-cn has no media entry in the source.
const IMAGE_MODELS = [
  ["agnes-image-2.0-flash", "Agnes Image 2.0 Flash"],
  ["agnes-image-2.1-flash", "Agnes Image 2.1 Flash"],
  ["agnes-image-2.5-flash", "Agnes Image 2.5 Flash"],
].map(([id, name]) => ({ id, name, kind: "image", inputModalities: ["text", "image"], params: ["size", "ratio", "response_format"] }));
const VIDEO_MODELS = [
  { id: "agnes-video-v2.0", name: "Agnes Video V2.0", kind: "video" },
  { id: "agnes-video-2.5-flash", name: "Agnes Video 2.5 Flash", kind: "video" },
  { id: "agnes-video-2.5", name: "Agnes Video 2.5", kind: "video" },
];

export default {
  id: "agnes",
  alias: "agnes",
  display: {
    name: "Agnes",
    icon: "route",
    color: "#2563EB",
    textIcon: "AG",
    notice: {
      text: "Agnes Flash models with reasoning effort levels; catalog from the public /v1/models endpoint.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  models: [
    { id: "agnes-2.0-flash", name: "Agnes 2.0 Flash", contextLength: 262144, supportsVision: true },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288, supportsVision: true },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash", contextLength: 524288, supportsVision: true },
    // Announced 2026-10-05; vendor docs list it as coming soon, seeded so the id is ready when it ships.
    { id: "agnes-3.0-pro", name: "Agnes 3.0 Pro", contextLength: 524288, supportsVision: true },
    ...IMAGE_MODELS,
    ...VIDEO_MODELS,
  ],
  modelsFetcher: { url: "https://apihub.agnes-ai.com/v1/models", type: "openai" },
  serviceKinds: ["llm", "image", "video"],
};
