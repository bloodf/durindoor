export default {
  id: "clova-studio",
  alias: "clova",
  display: {
    name: "Naver CLOVA Studio",
    icon: "auto_awesome",
    color: "#03C75A",
    textIcon: "CS",
    website: "https://api.ncloud-docs.com/docs/en/ai-naver-clovastudio-summary",
    notice: {
      apiKeyUrl: "https://clovastudio.ncloud.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://clovastudio.stream.ntruss.com/v1/openai/chat/completions",
    format: "openai",
  },
  models: [
    { id: "HCX-007", name: "HCX-007", contextLength: 128000, maxOutputTokens: 32768, supportsReasoning: true },
    { id: "HCX-005", name: "HCX-005", contextLength: 128000, maxOutputTokens: 4096, supportsVision: true },
    { id: "HCX-DASH-002", name: "HCX-DASH-002", contextLength: 32000, maxOutputTokens: 4096 },
  ],
  serviceKinds: ["llm"],
};
