import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "bailian-coding-plan",
  alias: "bcp",
  uiAlias: "bcp",
  display: {
    name: "Alibaba Coding Plan",
    icon: "code",
    color: "#FF6A00",
    textIcon: "BCP",
    website: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
  },
  category: "apikey",
  transport: {
    // DefaultExecutor uses baseUrl verbatim, so keep the Anthropic Messages path inline.
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
    // Bailian Coding Plan exposes an Anthropic Messages endpoint; keep
    // reasoning in the documented Claude shape (budget/adaptive via
    // FORMAT_TO_NATIVE for format:"claude"). DefaultExecutor will still
    // receive reasoning_effort from mixed-format clients and pass native
    // thinking fields to the Messages endpoint.
    thinkingFormat: "claude",
  },
  features: {
    usage: true,
    usageApikey: true,
  },
  models: [
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus(vision)", contextLength: 1000000 },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus", contextLength: 1000000 },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", contextLength: 262144 },
    { id: "glm-4.7", name: "GLM 4.7", contextLength: 202752 },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus(vision)" },
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus(vision)" },
    { id: "qwen3-max-2026-01-23", name: "Qwen3 Max" },
    { id: "kimi-k2.5", name: "Kimi K2.5(vision)" },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
  ],
};
