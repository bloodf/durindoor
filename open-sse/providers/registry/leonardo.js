import { LEONARDO_VIDEO_MODELS } from "../../services/providerParity/native-leonardo-video-image/config.js";

export default {
  id: "leonardo",
  priority: 70,
  alias: "leo",
  display: {
    name: "Leonardo.Ai",
    icon: "image",
    color: "#7C2D12",
    textIcon: "LE",
    website: "https://leonardo.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "phoenix", name: "Phoenix", kind: "image" },
    { id: "sdxl", name: "SDXL", kind: "image" },
    ...LEONARDO_VIDEO_MODELS.map(({ id, name }) => ({ id, name, kind: "video" })),
  ],
  // Native generation and reference-image edits in imageProviders and
  // imageEditProviders, video in videoProviders. No imageEditConfig (the OpenAI
  // multipart passthrough must not reach Leonardo) and no videoConfig (the
  // /v1/videos job proxy has no accepted-job ledger).
  serviceKinds: ["image", "video"],
  imageConfig: {
    baseUrl: "https://cloud.leonardo.ai/api/rest/v1",
    authType: "apikey",
    authHeader: "bearer",
  },
};
