import { SEGMIND_VIDEO_MODELS } from "../../services/providerParity/native-segmind-video/config.js";

export default {
  id: "segmind",
  priority: 70,
  alias: "segmind",
  display: {
    name: "Segmind",
    icon: "video",
    color: "#7C3AED",
    textIcon: "SG",
    website: "https://segmind.com",
    notice: {
      apiKeyUrl: "https://cloud.segmind.com/console/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.segmind.com/v1",
    authHeader: "x-api-key",
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  // Text-to-video starter slugs. Other text-to-video Segmind slugs route as
  // `segmind/<slug>`; image-to-video slugs are refused before submit.
  models: SEGMIND_VIDEO_MODELS.map(({ id, name }) => ({ id, name, kind: "video" })),
  // One synchronous POST per request in videoProviders; no videoConfig, so the
  // /v1/videos job proxy never sees Segmind. Never an LLM/chat provider.
  serviceKinds: ["video"],
};
