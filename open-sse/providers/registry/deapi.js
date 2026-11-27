import { DEAPI_IMAGE_MODELS, DEAPI_VIDEO_MODELS } from "../../services/providerParity/native-deapi-video-image/config.js";
import { DEAPI_STT_MODELS, DEAPI_TRANSCRIPTION_URL, DEAPI_TTS_MODELS } from "../../services/providerParity/native-deapi-tts-stt/config.js";
import { DEAPI_EMBEDDING_MODELS } from "../../services/providerParity/native-deapi-embedding/config.js";

export default {
  id: "deapi",
  priority: 70,
  alias: "deapi",
  display: {
    name: "deAPI",
    icon: "image",
    color: "#18181B",
    textIcon: "DE",
    website: "https://deapi.ai",
  },
  category: "apikey",
  authType: "apikey",
  // Media only: no chat transport. Every adapter sends the selected
  // connection's key as Authorization: Bearer to https://oai.deapi.ai only.
  transport: null,
  models: [
    ...DEAPI_IMAGE_MODELS.map(({ id, name }) => ({ id, name, kind: "image" })),
    ...DEAPI_VIDEO_MODELS.map(({ id, name }) => ({ id, name, kind: "video" })),
    ...DEAPI_TTS_MODELS.map(({ id, name }) => ({ id, name, kind: "tts" })),
    ...DEAPI_STT_MODELS.map(({ id, name }) => ({ id, name, kind: "stt" })),
    ...DEAPI_EMBEDDING_MODELS.map(({ id, name, dimensions }) => ({ id, name, kind: "embedding", dimensions })),
  ],
  // Image, video, speech and embeddings run the native adapters in
  // imageProviders, videoProviders, ttsProviders and embeddingProviders.
  // No imageConfig (its /images/generations URL would open the OpenAI
  // multipart /v1/images/edits passthrough), no ttsConfig (the adapter is in
  // TTS_ADAPTERS) and no videoConfig (the /v1/videos job proxy has no
  // accepted-job ledger). sttConfig marks the transcription transport;
  // sttCore sends deAPI to its native adapter, and translations stay off.
  serviceKinds: ["image", "video", "tts", "stt", "embedding"],
  sttConfig: { baseUrl: DEAPI_TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "openai", translationModels: [] },
};
