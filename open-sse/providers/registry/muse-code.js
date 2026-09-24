import {
  MUSE_CODE_DEVICE_CODE_URL,
  MUSE_CODE_INFERENCE_USER_AGENT,
  MUSE_CODE_MINT_URL,
  MUSE_CODE_RESPONSES_URL,
  MUSE_CODE_TOKEN_URL,
} from "../../config/museCode.js";

// Muse Code (Meta), the agentic coding CLI. Wire format is the OpenAI Responses
// API. Dual auth: sign in with the Muse device flow to use a Muse subscription
// (MuseCodeExecutor remints the inference key from the stored dca token), or
// paste a META_API_KEY.
export default {
  id: "muse-code",
  priority: 285,
  alias: "mc",
  uiAlias: "mc",
  display: {
    name: "Muse Code (Meta)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MC",
    website: "https://ai.developer.meta.com/docs/muse-code/auth",
    notice: {
      text: "Sign in with the Muse Code device flow (same as `muse login`) to use a Muse subscription, or paste a META_API_KEY.",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  transport: {
    baseUrl: MUSE_CODE_RESPONSES_URL,
    format: "openai-responses",
    headers: {
      "User-Agent": MUSE_CODE_INFERENCE_USER_AGENT,
    },
  },
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2" },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor" },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1" },
    { id: "llama-4-maverick", name: "Llama 4 Maverick" },
    { id: "llama-4-scout", name: "Llama 4 Scout" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "llama-3.1-405b", name: "Llama 3.1 405B" },
    { id: "llama-3.1-70b", name: "Llama 3.1 70B" },
    { id: "llama-3.1-8b", name: "Llama 3.1 8B" },
    { id: "llama-3.2-90b-vision", name: "Llama 3.2 90B Vision" },
    { id: "llama-3.2-11b-vision", name: "Llama 3.2 11B Vision" },
  ],
  serviceKinds: ["llm"],
  passthroughModels: true,
  oauth: {
    // Public Muse Code CLI client id (device grant, no secret, no PKCE).
    clientId: "1031625952748946",
    deviceCodeUrl: MUSE_CODE_DEVICE_CODE_URL,
    tokenUrl: MUSE_CODE_TOKEN_URL,
    mintUrl: MUSE_CODE_MINT_URL,
  },
};
