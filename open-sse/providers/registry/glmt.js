export default {
  id: "glmt",
  priority: 145,
  alias: "glmt",
  display: {
    name: "GLM T",
    icon: "code",
    color: "#2563EB",
    textIcon: "GT",
    website: "https://z.ai",
    notice: {
      apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    headers: {},
    timeoutMs: 900000,
    requestDefaults: {
      maxTokens: 65536,
      temperature: 0.2,
      thinkingBudgetTokens: 24576,
      thinkingType: "adaptive",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  // Ported from OmniRoute glm/t at source commit 3ddcee6.
  models: [
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.2-high", name: "GLM 5.2 High", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.2-max", name: "GLM 5.2 Max", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5.1", name: "GLM 5.1", contextLength: 204800, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5", name: "GLM 5", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-5-turbo", name: "GLM 5 Turbo", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-4.7", name: "GLM 4.7", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportsVision: true },
    { id: "glm-4.6", name: "GLM 4.6", contextLength: 200000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true },
    { id: "glm-4.5v", name: "GLM 4.5V (Vision)", contextLength: 16000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportsVision: true },
    { id: "glm-4.5", name: "GLM 4.5", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true },
    { id: "glm-4.5-air", name: "GLM 4.5 Air", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true },
  ],
  defaultContextLength: 1000000,
};
