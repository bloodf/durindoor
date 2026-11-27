import { HAIPER_IMAGE_MODELS, HAIPER_VIDEO_MODELS } from "../../services/providerParity/native-haiper-video-image/config.js";

export default {
  id: "haiper",
  priority: 70,
  alias: "hp",
  display: {
    name: "Haiper",
    icon: "video",
    color: "#7C3AED",
    textIcon: "HP",
    website: "https://haiper.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.haiper.ai/v1",
    authHeader: "HAIPER_KEY",
    auth: { combined: true, header: "HAIPER_KEY", scheme: "raw" },
  },
  // Gen 2 serves both media kinds under one id; never expose it as an LLM/chat model.
  models: [
    ...HAIPER_IMAGE_MODELS.map(({ id, name }) => ({ id, name, kind: "image" })),
    ...HAIPER_VIDEO_MODELS.map(({ id, name }) => ({ id, name, kind: "video" })),
  ],
  // Synchronous submit-and-poll adapters in imageProviders and videoProviders;
  // no videoConfig, so the /v1/videos job proxy never sees Haiper.
  serviceKinds: ["image", "video"],
};
