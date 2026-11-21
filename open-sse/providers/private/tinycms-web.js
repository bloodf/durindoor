// Ported from OmniRoute release/v3.8.55, open-sse/config/providers/registry/tinycms/index.ts.
export default {
  id: "tinycms-web", alias: "tcw",
  display: { name: "TinyCMS Web", icon: "hub", color: "#5B5BD6", textIcon: "TC", website: "https://site.tinycms.xyz" },
  category: "apikey", authType: "apikey", authHint: "Use the device UUID beginning with R from site.tinycms.xyz (localStorage app-config-uuid).",
  serviceKinds: ["llm"],
  transport: { baseUrl: "https://gov.freegpt.win/api/openai/oneapi/v1/chat/completions", format: "openai", executor: "tinycms-web", authType: "apikey" },
  models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-thinking-free", "gpt-5.3-free", "gpt-oss-120b", "gemini-3.6-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview", "grok-4.5", "deepseek-v4-pro", "deepseek-v4-flash", "kimi-k3", "glm-5.2", "qwen3.6-plus", "mimo-v2.5-pro", "mimo-v2.5"].map((id) => ({ id, name: id })),
};
