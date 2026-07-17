export default {
  id: "zai",
  alias: "zai",
  display: {
    name: "Z.AI",
    icon: "psychology",
    color: "#2563EB",
    textIcon: "ZA",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-5-turbo", name: "GLM 5 Turbo" },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "glm-4.7", name: "GLM 4.7" },
  ],
};
