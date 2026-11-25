// International API keys are distinct from China credentials. Tencent documents
// X-Api-Key at https://www.codebuddy.ai/docs/cli/iam; no public International
// OAuth client or account model-list endpoint is specified there.
export default {
  id: "codebuddy-intl",
  alias: "cbai",
  display: {
    name: "CodeBuddy International",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.ai",
    notice: { apiKeyUrl: "https://www.codebuddy.ai/profile/keys", text: "International API key. Model availability varies by account." },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    thinkingFormat: "openai",
    // The international gateway checks the CLI identity on chat requests.
    headers: { "User-Agent": "CLI/2.175.0 CodeBuddy/2.175.0", "X-IDE-Type": "CLI", "X-IDE-Name": "CLI", "X-IDE-Version": "2.175.0", "X-Product": "SaaS", "x-requested-with": "XMLHttpRequest", "x-codebuddy-request": "1" },
    auth: { combined: true, header: "X-Api-Key", scheme: "raw", hooks: ["codebuddyHeaders"] },
  },
  // Curated upstream fallback, not an account-specific entitlement list.
  models: [
    { id: "hy4-preview", name: "Hy4-Preview" },
    { id: "hy3", name: "Hy3" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" },
  ],
  passthroughModels: true,
};
